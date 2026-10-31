/**
 * Firestore Emulator integration. Data only in demo-atrio-v11 project.
 * The real read adapter is tested through an injection that strictly maps
 * its hard-coded production URL to the LOCAL EMULATOR, never the internet.
 *
 * Run only inside firebase emulators:exec; do not import this from a Worker.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';
import {
  createRelationalFirestoreReadAdapter
} from '../../cloudflare/account-deletion-audit/src/relational-firestore-read-adapter.js';
import {
  discoverRelationalCandidates,RELATIONAL_QUERY_SPECS,summarizeRelationalCandidates
} from '../../cloudflare/account-deletion-audit/src/relational-inventory.js';

const PORT=8089;
const HOST='127.0.0.1';
const DEMO='demo-atrio-v11';
const PROD='atrio-catolico';
const URI='https://firestore.googleapis.com/v1/projects/'+PROD+
  '/databases/(default)/documents:runQuery';
const path='projects/'+DEMO+'/databases/(default)/documents/';
const produced='projects/'+PROD+'/databases/(default)/documents/';
const uid='qa-privacy-alice';
const bob='qa-privacy-bob';
const token='emulator_fake_oauth_for_read_only_12345';
const fail=(reason)=>{throw Error('emulator_only_guard_failed: '+reason);};

// Abort before constructing any Firebase client if not explicitly invoked
// by the Firebase emulator runner.
const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST;
if(emulatorHost!==HOST+':'+PORT) fail('FIRESTORE_EMULATOR_HOST not explicitly local');
if(process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT!==DEMO)
  fail('unexpected GCLOUD_PROJECT');
const env=await initializeTestEnvironment({
  projectId:DEMO,
  firestore:{host:HOST,port:PORT,rules:readFileSync('firestore.rules','utf8')}
});
const results=[];
let requests=0;
const transport=async(url,opts)=>{
  if(url!==URI || opts.method!=='POST'||opts.redirect!=='error')
    fail('unexpected outbound destination or method');
  if(!opts.headers?.Authorization?.startsWith('Bearer '))
    fail('missing internal bearer on adapter request');
  const data=JSON.parse(opts.body);
  if(data?.structuredQuery?.from?.length!==1 ||
     typeof data.structuredQuery.from[0].collectionId!=='string')
    fail('invalid query');
  // Emulator project mapping is TEST-ONLY. Never forward OAuth tokens,
  // Firebase production URLs or real credentials.
  if(data.structuredQuery.startAt) {
    for (const v of data.structuredQuery.startAt.values) {
      if(typeof v.referenceValue!=='string' ||
        !v.referenceValue.startsWith(produced)) fail('untrusted cursor');
      v.referenceValue=v.referenceValue.replace(produced,path);
    }
  }
  requests++;
  const response=await fetch('http://'+HOST+':'+PORT+
    '/v1/projects/'+DEMO+'/databases/(default)/documents:runQuery',{
      method:'POST',redirect:'error',
      // Token "owner" e aceito somente pelo Firebase Emulator para bypass
      // de regras administrativas locais. Nao e uma credencial de producao.
      headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},
      body:JSON.stringify(data)
    });
  assert.equal(response.status,200,'Firestore Emulator rejected StructuredQuery');
  const text=await response.text();
  const docs=JSON.parse(text);
  assert.ok(Array.isArray(docs));
  // Namespace translation only; data/fields remain the real emulator response.
  for(const entry of docs) {
    if(entry.document?.name) {
      assert.ok(entry.document.name.startsWith(path));
      entry.document.name=entry.document.name.replace(path,produced);
    }
  }
  return new Response(JSON.stringify(docs),{status:200});
};
const adapter=createRelationalFirestoreReadAdapter(uid,token,transport);
const spec=id=>RELATIONAL_QUERY_SPECS.find(x=>x.id===id);
async function check(name,fn) {
  await fn();
  results.push(name);
  console.log('PASS EMULATOR PRIVACY',name);
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(let i=0;i<4;i++) {
      await setDoc(doc(db,'posts','qa_privacy_post_'+i),{
        uid:i===3?bob:uid,
        title:'FICTICIO - e-mail interno não deve vazar',
        body:'Simulado emulador isolado',
        createdAt:new Date('2026-10-31T12:00:00Z')
      });
    }
    await setDoc(doc(db,'posts','qa_privacy_post_0','replies','qa_reply_1'),{
      uid,body:'FICTICIO',authorName:'Fictício'
    });
    await setDoc(doc(db,'users',bob,'notifications','qa_notice_alice'),{
      actorUid:uid,body:'Mensagem privada de outra conta'
    });
    await setDoc(doc(db,'users',bob,'notifications','qa_notice_bob'),{
      actorUid:bob,body:'Notificação que NÃO pertence a Alice'
    });
    await setDoc(doc(db,'reports','qa_report_alice'),{
      reporterUid:uid,reason:'Denúncia fictícia sob retenção'
    });
  });

  await check('query posts filtered by UID and pagination over real Firestore Emulator',async()=>{
    const first=await adapter.queryPage(spec('owned_posts'),uid,null,2);
    assert.deepEqual(first.items.map(x=>x.path),[
      'posts/qa_privacy_post_0','posts/qa_privacy_post_1'
    ]);
    assert.ok(first.nextPageToken);
    const second=await adapter.queryPage(spec('owned_posts'),uid,first.nextPageToken,2);
    assert.deepEqual(second.items.map(x=>x.path),['posts/qa_privacy_post_2']);
    assert.equal(second.nextPageToken,null);
    assert.ok(first.items.every(x=>Object.keys(x.fields).length===1));
    assert.ok(!JSON.stringify([first,second]).includes('FICTICIO'));
  });
  await check('discover replies, third-party notifications and moderation references',async()=>{
    const found=await discoverRelationalCandidates(uid,adapter);
    const all=found.findings.map(x=>x.path);
    assert.ok(all.includes('posts/qa_privacy_post_0/replies/qa_reply_1'));
    assert.ok(all.includes('users/'+bob+'/notifications/qa_notice_alice'));
    assert.ok(all.includes('reports/qa_report_alice'));
    assert.ok(!all.includes('posts/qa_privacy_post_3'));
    assert.ok(!all.includes('users/'+bob+'/notifications/qa_notice_bob'));
    assert.equal(found.safeToExecute,false);
    assert.equal(found.globalCoverageComplete,false);
    assert.ok(found.findings.every(x=>x.automaticallyDeletable===false));
    const publicSummary=summarizeRelationalCandidates(found);
    assert.ok(publicSummary.groups.author_content>=4);
    assert.ok(publicSummary.groups.moderation_retention>=1);
    assert.ok(publicSummary.groups.cross_account_reference>=1);
    for(const privateText of [uid,bob,'qa_privacy_post','FICTICIO']) {
      assert.ok(!JSON.stringify(publicSummary).includes(privateText));
    }
  });
  await check('no accidental production calls or deletions',async()=>{
    assert.ok(requests>=RELATIONAL_QUERY_SPECS.length+2);
    const owner=await env.withSecurityRulesDisabled(async ctx=>{
      const {getDoc}=await import('firebase/firestore');
      const x=await getDoc(doc(ctx.firestore(),'posts','qa_privacy_post_0'));
      return x.data()?.uid;
    });
    assert.equal(owner,uid);
  });
  console.log('OK: '+results.length+' cenários no Firestore Emulator, nenhuma exclusão');
} finally {
  await env.cleanup();
}
