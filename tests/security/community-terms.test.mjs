/**
 * Contrato de aceite UGC versionado: teste SOMENTE no Firestore Emulator.
 * Configuracao real nao e criada/deployada por este teste.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc, serverTimestamp, Timestamp} from 'firebase/firestore';

const env = await initializeTestEnvironment({projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}});
const alice=env.authenticatedContext('terms-alice').firestore();
const bob=env.authenticatedContext('terms-bob').firestore();
const anon=env.unauthenticatedContext().firestore();
const configPath='app_config/community_terms';
let passed=0;
const check=async(label,fn)=>{await fn();passed++;console.log('PASS TERMS',label)};
const post=(db,uid,id)=>setDoc(doc(db,'posts/'+id),{
  uid,authorName:uid==='terms-alice'?'Alice':'Bob',
  title:'Discussão de teste',body:'Texto de teste para a comunidade',
  category:'Liturgia',createdAt:serverTimestamp()
});
const reply=(db,id,uid)=>setDoc(doc(db,'posts/prior/replies/'+id),{
  uid,authorName:uid==='terms-alice'?'Alice':'Bob',
  body:'Resposta de QA',createdAt:serverTimestamp()
});
const acceptance=(db,uid,version)=>setDoc(
  doc(db,'users/'+uid+'/acceptedTerms/'+version),{
    version,acceptedAt:serverTimestamp()
  });
const config=(version,enforce=true,published=true)=>({
  version,enforce,published,url:'https://qa.example.test/community-terms'
});
const adminWrite=async(data)=>env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),configPath),data);
});
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    for(const [uid,displayName] of [['terms-alice','Alice'],['terms-bob','Bob']]){
      await setDoc(doc(ctx.firestore(),'profiles/'+uid),{
        displayName,createdAt:Timestamp.now()
      });
    }
  });
  await check('legado sem config continua criando post',()=>assertSucceeds(
    post(alice,'terms-alice','prior')));
  await check('cliente nao define configuracao dos termos',()=>assertFails(
    setDoc(doc(alice,configPath),config('community-v1'))));
  await check('cliente nao publica aceite antes da politica efetiva',()=>assertFails(
    acceptance(alice,'terms-alice','community-v1')));
  await adminWrite(config('community-v1'));
  await check('politica vigente e consultavel so autenticado',async()=>{
    const data=await assertSucceeds(getDoc(doc(alice,configPath)));
    assert.equal(data.data().version,'community-v1');
    await assertFails(getDoc(doc(anon,configPath)));
  });
  await check('sem aceite nenhum post novo',()=>assertFails(
    post(alice,'terms-alice','new1')));
  await check('sem aceite nenhuma resposta nova',()=>assertFails(
    reply(bob,'reply1','terms-bob')));
  await check('nao aceitar na conta alheia',()=>assertFails(
    acceptance(alice,'terms-bob','community-v1')));
  await check('nao aceitar versao inexistente',()=>assertFails(
    acceptance(alice,'terms-alice','community-v77')));
  await check('nao forjar timestamp nem campos privilegiados',async()=>{
    await assertFails(setDoc(doc(alice,'users/terms-alice/acceptedTerms/community-v1'),{
      version:'community-v1',acceptedAt:Timestamp.fromMillis(1000)
    }));
    await assertFails(setDoc(doc(alice,'users/terms-alice/acceptedTerms/community-v1'),{
      version:'community-v1',acceptedAt:serverTimestamp(),isAdmin:true
    }));
  });
  await check('titular registra aceite atual',()=>assertSucceeds(
    acceptance(alice,'terms-alice','community-v1')));
  await check('aceite acessivel so pelo titular',async()=>{
    await assertSucceeds(getDoc(doc(alice,'users/terms-alice/acceptedTerms/community-v1')));
    await assertFails(getDoc(doc(bob,'users/terms-alice/acceptedTerms/community-v1')));
    await assertFails(getDocs(collection(bob,'users/terms-alice/acceptedTerms')));
  });
  await check('nao reescrever nem apagar consentimento auditavel',async()=>{
    const ref=doc(alice,'users/terms-alice/acceptedTerms/community-v1');
    await assertFails(updateDoc(ref,{acceptedAt:serverTimestamp()}));
    await assertFails(deleteDoc(ref));
  });
  await check('titular autorizado publica e responde',async()=>{
    await assertSucceeds(post(alice,'terms-alice','new2'));
    await assertSucceeds(reply(alice,'reply2','terms-alice'));
  });
  await check('nao basta o aceite de outro usuario',()=>assertFails(
    post(bob,'terms-bob','new3')));
  await adminWrite(config('community-v2'));
  await check('nova versao invalida aceite antigo',async()=>{
    await assertFails(post(alice,'terms-alice','new4'));
    await assertFails(reply(alice,'reply3','terms-alice'));
  });
  await check('aceite da nova versao reabilita publicacao',async()=>{
    await assertSucceeds(acceptance(alice,'terms-alice','community-v2'));
    await assertSucceeds(post(alice,'terms-alice','new5'));
  });
  await adminWrite(config('community-v3',true,false));
  await check('config publicada false nega criacao mesmo que aceites antigos existam',async()=>{
    await assertFails(post(alice,'terms-alice','new6'));
    await assertFails(acceptance(alice,'terms-alice','community-v3'));
  });
  await adminWrite(config('community-v3',false,false));
  await check('enforce=false permite legado ate ativacao controlada',()=>assertSucceeds(
    post(bob,'terms-bob','legacy2')));
  console.log('OK: '+passed+' cenarios de termos e publicacao no emulador');
}finally{await env.cleanup()}
