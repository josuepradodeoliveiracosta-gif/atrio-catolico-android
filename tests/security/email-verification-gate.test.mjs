/**
 * Rollout de email verificado para novas publicacoes e respostas.
 * Nada aqui consulta Firebase produtivo; todo o fluxo usa Firestore Emulator.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, serverTimestamp
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const unchecked = env.authenticatedContext('unverified',{
  email:'unverified@example.test',email_verified:false
}).firestore();
const checked = env.authenticatedContext('verified',{
  email:'verified@example.test',email_verified:true
}).firestore();
const legacy = env.authenticatedContext('legacy',{
  email:'legacy@example.test',email_verified:false
}).firestore();
const anon = env.unauthenticatedContext().firestore();
const configPath = 'app_config/email_verification';
const post = (db,uid,id) => setDoc(doc(db,'posts/'+id),{
  uid,authorName:uid,title:'Discussao de ensaio',
  body:'Conteudo permitido pela comunidade para testes',
  category:'Liturgia',createdAt:serverTimestamp()
});
const reply = (db,uid,id) => setDoc(doc(db,'posts/post-verified/replies/'+id),{
  uid,authorName:uid,body:'Resposta de ensaio',createdAt:serverTimestamp()
});
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS EMAIL GATE',name);}
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for (const uid of ['unverified','verified','legacy'])
      await setDoc(doc(db,'profiles/'+uid),{displayName:uid,createdAt:serverTimestamp()});
  });
  await check('cliente nao pode criar configuracao de verificacao', () =>
    assertFails(setDoc(doc(unchecked,configPath),{
      enabled:true,version:'2026-11-v1'
    })));
  await check('sem configuracao conta antiga publica', () =>
    assertSucceeds(post(legacy,'legacy','legacy-before')));
  await check('sem configuracao email nao confirmado pode publicar', () =>
    assertSucceeds(post(unchecked,'unverified','unverified-before')));

  await env.withSecurityRulesDisabled(async ctx=>
    setDoc(doc(ctx.firestore(),configPath),{
      enabled:false,version:'2026-11-v1'
    }));
  await check('configuracao nao pode ser alterada por usuarios', () =>
    assertFails(updateDoc(doc(unchecked,configPath),{enabled:true})));
  await check('configuracao nao pode ser lida anonimamente', () =>
    assertFails(getDoc(doc(anon,configPath))));
  await check('configuracao pode ser consultada por membro', () =>
    assertSucceeds(getDoc(doc(checked,configPath))));
  await check('configuracao nao pode ser enumerada', () =>
    assertFails(getDocs(collection(unchecked,'app_config'))));
  await check('flag desligada nao prejudica clientes antigos', () =>
    assertSucceeds(post(legacy,'legacy','legacy-flag-off')));

  await env.withSecurityRulesDisabled(async ctx=>
    updateDoc(doc(ctx.firestore(),configPath),{enabled:true}));
  await check('email verificado pode publicar com flag ativa', () =>
    assertSucceeds(post(checked,'verified','post-verified')));
  // Um campo gravado em perfil (ou removido dele) nao pode falsificar
  // o claim emitido pelo Firebase Authentication.
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await updateDoc(doc(db,'profiles/unverified'),{email_verified:true});
    await updateDoc(doc(db,'profiles/verified'),{email_verified:false});
  });
  await check('campo de perfil nao substitui email_verified do Auth', () =>
    assertFails(post(unchecked,'unverified','forged-profile-claim')));
  await check('perfil sem flag nao invalida claim verificado do Auth', () =>
    assertSucceeds(post(checked,'verified','verified-auth-only')));
  await check('email nao confirmado nao pode publicar com flag ativa', () =>
    assertFails(post(unchecked,'unverified','unverified-denied')));
  await check('email nao confirmado nao pode responder com flag ativa', () =>
    assertFails(reply(unchecked,'unverified','unverified-reply-denied')));
  await check('email verificado pode responder com flag ativa', () =>
    assertSucceeds(reply(checked,'verified','verified-reply')));
  // A UI nao e uma fronteira de seguranca: leitura direta via SDK tambem
  // deve ser negada enquanto a exigencia administrativa estiver ativa.
  await check('sem verificacao nao le publicacoes diretamente', () =>
    assertFails(getDoc(doc(unchecked,'posts/post-verified'))));
  await check('sem verificacao nao enumera o feed', () =>
    assertFails(getDocs(collection(unchecked,'posts'))));
  await check('sem verificacao nao le respostas diretamente', () =>
    assertFails(getDoc(doc(unchecked,'posts/post-verified/replies/verified-reply'))));
  await check('sem verificacao nao lista respostas', () =>
    assertFails(getDocs(collection(unchecked,'posts/post-verified/replies'))));
  await check('email confirmado continua lendo o forum', () =>
    assertSucceeds(getDoc(doc(checked,'posts/post-verified'))));
  await check('email confirmado continua lendo respostas', () =>
    assertSucceeds(getDoc(doc(checked,'posts/post-verified/replies/verified-reply'))));
  await check('email nao confirmado nao edita publicacao anterior', () =>
    assertFails(updateDoc(doc(unchecked,'posts/unverified-before'),{
      title:'Alteracao de ensaio',body:'Teste de bloqueio de edicao',
      updatedAt:serverTimestamp()
    })));
  await check('email nao confirmado nao apaga publicacao anterior', () =>
    assertFails(deleteDoc(doc(unchecked,'posts/unverified-before'))));
  await check('email nao confirmado nao reage a respostas', () =>
    assertFails(setDoc(doc(unchecked,
      'posts/post-verified/replies/verified-reply/reactions/unverified'),{
      kind:'heart',createdAt:serverTimestamp()
    })));
  for (const path of ['likedPosts','savedPosts','followedPosts']) {
    await check('sem verificacao nao altera '+path, () =>
      assertFails(setDoc(doc(unchecked,'users/unverified/'+path+'/post-verified'),{
        createdAt:serverTimestamp()
      })));
  }
  await check('sem verificacao nao consulta notificacoes comunitarias', () =>
    assertFails(getDocs(collection(unchecked,'users/unverified/notifications'))));
  await check('sem verificacao nao registra token de push', () =>
    assertFails(setDoc(doc(unchecked,'users/unverified/pushDevices/qa-device'),{
      token:'qa-token-demonstracao-de-tamanho-suficiente',
      updatedAt:serverTimestamp()
    })));
  await check('email nao confirmado ainda pode consultar perfil privado', () =>
    assertSucceeds(getDoc(doc(unchecked,'profiles/unverified'))));
  await check('email nao confirmado ainda pode consultar a politica', () =>
    assertSucceeds(getDoc(doc(unchecked,configPath))));

  await env.withSecurityRulesDisabled(async ctx=>
    updateDoc(doc(ctx.firestore(),configPath),{version:'versao-desconhecida'}));
  await check('versao incorreta nao bloqueia cliente legado', () =>
    assertSucceeds(post(legacy,'legacy','legacy-wrong-version')));
  await check('versao incorreta restaura leitura comunitaria', () =>
    assertSucceeds(getDoc(doc(unchecked,'posts/post-verified'))));
  await env.withSecurityRulesDisabled(async ctx=>
    updateDoc(doc(ctx.firestore(),configPath),{enabled:false,version:'2026-11-v1'}));
  await check('desativacao reverte a exigencia sem mudar contas', () =>
    assertSucceeds(reply(unchecked,'unverified','unverified-after-disable')));
  await check('desativacao restaura leitura das publicacoes', () =>
    assertSucceeds(getDoc(doc(unchecked,'posts/post-verified'))));
  console.log('OK: '+passed+' verificacoes de email no Firestore Emulator.');
} finally {
  await env.cleanup();
}
