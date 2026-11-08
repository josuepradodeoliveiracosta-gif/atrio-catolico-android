// Somente Firebase Emulator: nao altera firestore.rules nem dados reais.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,writeBatch,serverTimestamp} from 'firebase/firestore';

const original=readFileSync('firestore.rules','utf8');
const from='      match /replies/{replyId} {\n';
const until='        match /reactions/{uid} {';
const i=original.indexOf(from),j=original.indexOf(until,i);
assert.ok(i>=0&&j>i&&original.split(from).length===2);
const helpers=[
'        function labNoticeFlag() {',
'          let p=/databases/$(database)/documents/app_config/reply_notification_policy;',
"          return exists(p) && get(p).data.get('enabled',false) == true;",
'        }',
'        function labOwnerNotice(postId,replyId) {',
'          let post=/databases/$(database)/documents/posts/$(postId);',
'          let owner=get(post).data.uid;',
'          let n=/databases/$(database)/documents/users/$(owner)/notifications/$(replyId);',
'          return owner == request.auth.uid',
'            || (!exists(n) && existsAfter(n)',
'                && getAfter(n).data.postId == postId',
'                && getAfter(n).data.replyId == replyId',
'                && getAfter(n).data.actorUid == request.auth.uid',
'                && getAfter(n).data.actorName == request.resource.data.authorName',
'                && getAfter(n).data.read == false',
'                && getAfter(n).data.createdAt == request.time);',
'        }',''
].join('\n');
let block=original.slice(i,j);
assert.equal(block.split('          && validTime()').length,2);
block=block.replace(from,from+helpers).replace('          && validTime()',
  '          && validTime()\n          && (!labNoticeFlag() || labOwnerNotice(postId,replyId))');
const candidate=original.slice(0,i)+block+original.slice(j);
const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:candidate}});
const ca='qa-migration-clara',mi='qa-migration-miguel',postId='qa_notice_migration';
const clara=env.authenticatedContext(ca).firestore();
const miguel=env.authenticatedContext(mi).firestore();
const replyRef=id=>doc(miguel,'posts',postId,'replies',id);
const noticeRef=id=>doc(miguel,'users',ca,'notifications',id);
const reply=id=>({uid:mi,authorName:'Miguel QA',body:'QA '+id,
  createdAt:serverTimestamp()});
const notice=id=>({postId,replyId:id,actorUid:mi,
  actorName:'Miguel QA',read:false,createdAt:serverTimestamp()});
let checks=0;
async function check(label,action) {
  await action(); checks++; console.log('PASS NOTICE-LAB',label);
}
async function flag(enabled) {
  await env.withSecurityRulesDisabled(async admin=>{
    await setDoc(doc(admin.firestore(),'app_config/reply_notification_policy'),
      {enabled,policyVersion:'lab-only'});
  });
}
try {
  await env.clearFirestore();
  await assertSucceeds(setDoc(doc(clara,'profiles',ca),
    {displayName:'Clara QA',createdAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(miguel,'profiles',mi),
    {displayName:'Miguel QA',createdAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(clara,'posts',postId),
    {uid:ca,authorName:'Clara QA',title:'QA Avisos',
      body:'Discussao ficticia de compatibilidade de notificacoes',
      category:'Vida espiritual',createdAt:serverTimestamp()}));
  await check('sem flag cliente antigo pode responder',()=>assertSucceeds(
    setDoc(replyRef('old_missing'),reply('old_missing'))));
  await flag(false);
  await check('flag false preserva cliente antigo',()=>assertSucceeds(
    setDoc(replyRef('old_disabled'),reply('old_disabled'))));
  await check('cliente comum nao altera flag',()=>assertFails(
    setDoc(doc(miguel,'app_config/reply_notification_policy'),
      {enabled:true,policyVersion:'lab-only'})));
  await flag(true);
  await check('flag true rejeita resposta sem aviso',()=>assertFails(
    setDoc(replyRef('strict_no_notice'),reply('strict_no_notice'))));
  await check('aviso isolado nao passa',()=>assertFails(
    setDoc(noticeRef('fake'),notice('fake'))));
  await check('aviso para destinatario errado nao passa',async()=>{
    const id='wrong',b=writeBatch(miguel);
    b.set(replyRef(id),reply(id));
    b.set(doc(miguel,'users',mi,'notifications',id),notice(id));
    await assertFails(b.commit());
  });
  await check('resposta e aviso canonicos no batch passam',async()=>{
    const id='strict_ok',b=writeBatch(miguel);
    b.set(replyRef(id),reply(id)); b.set(noticeRef(id),notice(id));
    await assertSucceeds(b.commit());
    const r=await assertSucceeds(getDoc(doc(clara,'posts',postId,'replies',id)));
    const n=await assertSucceeds(getDoc(doc(clara,'users',ca,'notifications',id)));
    assert.equal(r.data()?.uid,mi); assert.equal(n.data()?.replyId,id);
  });
  await check('autor responde sem autoaviso',()=>assertSucceeds(
    setDoc(doc(clara,'posts',postId,'replies','self'),
      {uid:ca,authorName:'Clara QA',body:'Auto-resposta',
        createdAt:serverTimestamp()})));
  await check('rollback restaura compatibilidade',async()=>{
    await flag(false);
    await assertSucceeds(setDoc(replyRef('rollback'),reply('rollback')));
  });
  console.log(JSON.stringify({checks,environment:'emulator-only',
    productionWrites:0,rulesDeployed:false,result:'passed'}));
} finally {
  await env.cleanup();
}
