/**
 * CONTRATO CRIPTOGRAFICO DE LABORATORIO QA — NAO IMPLANTAR.
 *
 * Este modulo NAO comprova idade, NAO integra fornecedor e NAO escreve
 * Firestore. Ele valida atestacoes Ed25519 totalmente sinteticas para
 * definir os requisitos do FUTURO backend de afericao 18+.
 *
 * A chave publica permitida, o issuer esperado e o desafio de uso unico
 * precisam vir do servidor; NUNCA de parametros escolhidos pelo cliente.
 * O Set de JTIs aqui e APENAS um mock offline: em servidores reais
 * seria obrigatoria uma operacao atomica e persistente contra replay.
 */
import {verify as verifySignature} from 'node:crypto';

export const QA_AGE18_ATTESTATION_AUDIENCE='atrio-chat-age-qa-offline-v1';
export const QA_AGE18_ATTESTATION_POLICY='2026-11-18plus-qa-v1';
const approvedHeaderKeys=['alg','kid','typ'];
const approvedClaimKeys=['ageAtLeast18','aud','exp','iat','iss','jti','nonce','policyVersion','sub'];

const exactFields=(value,allowed)=>
  value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|')===allowed.join('|');

function parseCanonicalJson(encoded) {
  if(typeof encoded!=='string' || !/^[A-Za-z0-9_-]+$/.test(encoded) ||
     encoded.length>2700) return null;
  const bytes=Buffer.from(encoded,'base64url');
  if(bytes.toString('base64url')!==encoded) return null;
  const obj=JSON.parse(bytes.toString('utf8'));
  return obj && typeof obj==='object' && !Array.isArray(obj)?obj:null;
}

/**
 * Retorna null ao menor erro. A resposta nao e uma permissao Firestore.
 * Todos os inputs de confianca estao sob controle exclusivo do teste.
 */
export function verifyAge18AttestationOffline({
  compactJws, expectedUid, expectedNonce, trustedIssuer,
  trustedPublicKeys, consumedJtis, nowSeconds
}={}) {
  try {
    if(typeof compactJws!=='string' || compactJws.length>4096 ||
       !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compactJws) ||
       !/^[A-Za-z0-9_-]{1,128}$/.test(expectedUid) ||
       !/^[A-Za-z0-9_-]{22,128}$/.test(expectedNonce) ||
       typeof trustedIssuer!=='string' || trustedIssuer.length<8 ||
       !trustedPublicKeys || typeof trustedPublicKeys!=='object' ||
       !(consumedJtis instanceof Set) ||
       !Number.isSafeInteger(nowSeconds) || nowSeconds<=0) return null;
    const [encodedHeader,encodedPayload,encodedSig]=compactJws.split('.');
    const header=parseCanonicalJson(encodedHeader);
    const claims=parseCanonicalJson(encodedPayload);
    if(!exactFields(header,approvedHeaderKeys) ||
       !exactFields(claims,approvedClaimKeys) ||
       header.alg!=='EdDSA' || header.typ!=='JWT' ||
       typeof header.kid!=='string' ||
       !/^[A-Za-z0-9_-]{1,64}$/.test(header.kid) ||
       !Object.prototype.hasOwnProperty.call(trustedPublicKeys,header.kid)) return null;
    const publicKey=trustedPublicKeys[header.kid];
    const signature=Buffer.from(encodedSig,'base64url');
    if(signature.length!==64 || signature.toString('base64url')!==encodedSig ||
       !verifySignature(null,Buffer.from(encodedHeader+'.'+encodedPayload),
         publicKey,signature)) return null;

    if(claims.iss!==trustedIssuer ||
       claims.aud!==QA_AGE18_ATTESTATION_AUDIENCE ||
       claims.sub!==expectedUid ||
       claims.nonce!==expectedNonce ||
       claims.policyVersion!==QA_AGE18_ATTESTATION_POLICY ||
       claims.ageAtLeast18!==true ||
       !/^[A-Za-z0-9_-]{16,128}$/.test(claims.jti) ||
       !Number.isSafeInteger(claims.iat) ||
       !Number.isSafeInteger(claims.exp) ||
       claims.iat>nowSeconds+30 ||
       claims.exp<=nowSeconds ||
       claims.exp<=claims.iat ||
       claims.exp-claims.iat>300 ||
       consumedJtis.has(claims.jti)) return null;

    // Mock de consumo unico. NÃO é seguro para múltiplos servidores.
    consumedJtis.add(claims.jti);
    return Object.freeze({accepted:true,subjectUid:expectedUid});
  } catch {
    return null;
  }
}
