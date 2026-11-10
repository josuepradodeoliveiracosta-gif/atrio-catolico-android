/**
 * MODELO DE VINCULO EXCLUSIVAMENTE OFFLINE (QA) — NAO IMPLANTAR.
 *
 * Nenhum token Firebase e autenticado aqui. O callback resolveSession
 * simula um backend que JA verificou uma sessao via Admin SDK;
 * ele NAO pode ser implementado apenas a partir de dados do cliente.
 * Este laboratorio nao emite permissao, nao escreve Firestore e nunca
 * comprova a idade de uma pessoa.
 *
 * Todas as stores sao Map/Set em memoria de TESTE, NAO atomicas,
 * NAO distribuidas nem persistentes. Nao usar em Cloudflare/produçao.
 */
import {randomBytes} from 'node:crypto';
import {verifyAge18AttestationOffline,
  QA_AGE18_ATTESTATION_POLICY} from './age18-attestation-contract.mjs';

const uidPattern=/^[A-Za-z0-9_-]{1,128}$/;
const sessionPattern=/^[A-Za-z0-9_-]{16,128}$/;
const tokenPattern=/^[A-Za-z0-9_-]{16,256}$/;
const noncePattern=/^[A-Za-z0-9_-]{32,128}$/;
const CHALLENGE_TTL_SECONDS=120;

export function createAge18OfflineBindingLab({
  resolveSession, trustedIssuer, trustedPublicKeys,
  makeNonce=()=>randomBytes(24).toString('base64url')
}={}) {
  if(typeof resolveSession!=='function' ||
     typeof trustedIssuer!=='string' || trustedIssuer.length<8 ||
     !trustedPublicKeys || typeof trustedPublicKeys!=='object')
    throw Error('offline_lab_requires_server_owned_dependencies');

  // Congelar uma cópia da lista de confiança: mutações externas do mapa
  // de chaves não podem passar a autorizar assinaturas durante a sessão.
  const serverPinnedKeys=Object.freeze({...trustedPublicKeys});
  const challenges=new Map();
  const bySession=new Map();
  const usedJtis=new Set();
  const issuedNonces=new Set(); // somente mock, não persiste reinícios
  const readSession=token=>{
    if(typeof token!=='string' || !tokenPattern.test(token))return null;
    try{
      const s=resolveSession(token);
      return s && uidPattern.test(s.uid) && sessionPattern.test(s.sessionId)
        ? {uid:s.uid,sessionId:s.sessionId}:null;
    }catch{return null;}
  };
  const scope=s=>s.uid+'\u0000'+s.sessionId;
  const isValidTime=t=>Number.isSafeInteger(t) && t>0;

  function begin({authenticatedSessionToken,nowSeconds}={}) {
    const s=readSession(authenticatedSessionToken);
    if(!s || !isValidTime(nowSeconds) ||
       !Number.isSafeInteger(nowSeconds+CHALLENGE_TTL_SECONDS))return null;
    let nonce;
    try{nonce=makeNonce();}catch{return null;}
    if(typeof nonce!=='string' || !noncePattern.test(nonce) ||
       issuedNonces.has(nonce))return null;
    const key=scope(s),previous=bySession.get(key);
    if(previous)challenges.delete(previous);
    bySession.set(key,nonce);
    issuedNonces.add(nonce);
    challenges.set(nonce,{
      uid:s.uid,sessionId:s.sessionId,issuedAt:nowSeconds,
      expiresAt:nowSeconds+CHALLENGE_TTL_SECONDS
    });
    return Object.freeze({challengeNonce:nonce,expiresAt:nowSeconds+CHALLENGE_TTL_SECONDS});
  }

  function complete({
    authenticatedSessionToken,challengeNonce,compactJws,nowSeconds
  }={}) {
    const s=readSession(authenticatedSessionToken);
    if(!s || typeof challengeNonce!=='string' ||
       !noncePattern.test(challengeNonce) || !isValidTime(nowSeconds))return null;
    const entry=challenges.get(challengeNonce);
    if(!entry || entry.uid!==s.uid || entry.sessionId!==s.sessionId ||
       bySession.get(scope(s))!==challengeNonce)return null;
    // Relogio do servidor andando para trás nunca pode validar desafio.
    if(nowSeconds<entry.issuedAt)return null;
    if(entry.expiresAt<=nowSeconds){
      challenges.delete(challengeNonce);
      bySession.delete(scope(s));
      return null;
    }
    const proof=verifyAge18AttestationOffline({
      compactJws,expectedUid:s.uid,expectedNonce:challengeNonce,
      trustedIssuer,trustedPublicKeys:serverPinnedKeys,
      consumedJtis:usedJtis,nowSeconds
    });
    if(!proof)return null;
    challenges.delete(challengeNonce);
    bySession.delete(scope(s));
    return Object.freeze({
      simulatedOnly:true,subjectUid:s.uid,
      minimumAge:18,policyVersion:QA_AGE18_ATTESTATION_POLICY
    });
  }

  return Object.freeze({begin,complete});
}
