import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Firestore,Timestamp} from '@google-cloud/firestore';
import {assertFails,initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {
  collection,deleteDoc,doc,getDocsFromServer,limit,query,serverTimestamp,
  setDoc,updateDoc,where,writeBatch
} from 'firebase/firestore';
import {
  createAdminInboxStore,createAuthorizedInboxService,createInboxHttpHandler
} from '../../firebase/qa-general/chat-inbox-discovery-server.mjs';
import {
  beginInboxBackfill,beginInboxEligibilityChange,advanceInboxMaintenance,writeInboxBlock
} from '../../firebase/qa-general/chat-inbox-maintenance.mjs';
import {
  INBOX_DISCOVERY_CONTROL,INBOX_DISCOVERY_SCHEMA,INBOX_WRITE_BOUNDARY,INBOX_WRITE_POLICY
} from '../../firebase/qa-general/chat-inbox-peer-index.mjs';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
const projectId='demo-atrio-v11';
const db=new Firestore({projectId});
const env=await initializeTestEnvironment({projectId,firestore:{
  host:'127.0.0.1',port:8089,rules:readFileSync('qa-parity.generated.rules','utf8')
}});
const now=Date.now();
const minute=60_000;
const a='qa-alice',b='qa-bob',c='qa-clara',d='qa-dan',e='qa-eli',f='qa-fred',x='qa-expired';
const fanout=Array.from({length:23},(_,i)=>'qa-peer-'+String(i).padStart(2,'0'));
const grant=(offset,policy='legacy')=>({
  status:policy==='legacy'?'eligible':'declared_18_plus',minimumAge:18,
  policyVersion:policy==='legacy'?'2026-11-18plus-qa-v1':'2026-11-selfdecl-qa-v1',
  reviewExpiresAt:Timestamp.fromMillis(now+offset*minute)
});
const agePath=uid=>'users/'+uid+'/chatAgeEligibility/current';
const blockPath=(owner,peer)=>'users/'+owner+'/blockedMembers/'+peer;
const id=(u,v)=>u+'__'+v;
const row=(uid,chat,policy='legacy')=>'serverInboxOwners/'+uid+'/'+policy+'/'+chat;
const control=()=>db.doc(INBOX_DISCOVERY_CONTROL);
const ageByUid=new Map([[a,grant(90)],[b,grant(10)],[c,grant(20)],[d,grant(30)],
  [e,grant(40,'selfDeclared')],[f,grant(50)],[x,grant(-1)],...fanout.map(uid=>[uid,grant(80)])]);
const visiblePairs=[[a,b],[a,c],[a,d],[a,e],[e,f],[a,x],...fanout.map(uid=>[b,uid])];
const blockedPairs=[[a,f]];
const chat=(u,v)=>({
  participants:[u,v],requesterUid:u,recipientUid:v,lastPreview:'Fixture QA',
  status:'accepted',updatedAt:Timestamp.fromMillis(now),lastSenderUid:u
});
const service=createAuthorizedInboxService({
  verifyIdToken:async(uid,checkRevoked)=>{
    assert.equal(checkRevoked,true);
    if(!ageByUid.has(uid))throw Error('fixture Auth');
    return {uid,email_verified:true};
  },
  store:createAdminInboxStore(db),cursorKey:randomBytes(32)
});
const handler=createInboxHttpHandler(service,{enabled:true});
async function http(uid,cursor=null,{enabled=true,limit=1}={}) {
  const url=new URL('https://fixture.invalid/v1/qa/conversations/inbox');
  url.searchParams.set('limit',limit);
  if(cursor)url.searchParams.set('cursor',cursor);
  const handle=enabled?handler:createInboxHttpHandler(service);
  const result=await handle(new Request(url,{headers:{Authorization:'Bearer '+uid}}));
  assert.match(result.headers.get('cache-control'),/no-store/);
  return {status:result.status,body:await result.json()};
}
async function finish(id,limit=3) {
  for(let i=0;i<100;i++){
    const result=await advanceInboxMaintenance(db,id,{limit});
    if(result.done)return result;
  }
  assert.fail('checkpoint da carga nao terminou');
}
async function readRows(){
  const groups=await Promise.all(['legacy','selfDeclared'].map(name=>db.collectionGroup(name).get()));
  return Object.fromEntries(groups.flatMap(query=>query.docs)
    .filter(snap=>snap.ref.path.startsWith('serverInboxOwners/'))
    .map(snap=>[snap.ref.path,snap.data()]));
}
function expectedRows(pairs) {
  const rows={};
  for(const pair of pairs) {
    for(const [owner,peer] of [pair,[...pair].reverse()]){
      const grant=ageByUid.get(peer);
      if(grant) rows[row(owner,id(...pair),grant.status==='eligible'?'legacy':'selfDeclared')]={
        peerExpiresAtMs:grant.reviewExpiresAt.toMillis()
      };
    }
  }
  return rows;
}
const command=(operationId,ownerUid,peerUid,blocked,expectedVersion=null)=>({
  operationId,ownerUid,peerUid,blocked,expectedVersion,createdAt:Timestamp.fromMillis(now)
});
async function traverse(uid){
  const peers=[];
  let cursor=null;
  do {
    const page=await http(uid,cursor);
    assert.equal(page.status,200);
    peers.push(...page.body.items.map(item=>item.peerUid));
    cursor=page.body.nextCursor;
    assert.ok(peers.length<=visiblePairs.length);
  } while(cursor);
  return peers;
}
let count=0;
async function check(label,run) {
  await run();
  count++;
  console.log('PASS INBOX MAINTENANCE',label);
}

try {
  await env.clearFirestore();
  const setup=db.batch();
  setup.set(db.doc('app_config/conversations'),{
    enabled:true,minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1',
    version:'2026-11-v1'
  });
  for(const [uid,value] of ageByUid)setup.set(db.doc(agePath(uid)),value);
  for(const pair of [...visiblePairs,...blockedPairs])setup.set(db.doc('chats/'+id(...pair)),chat(...pair));
  setup.set(db.doc(blockPath(f,a)),{createdAt:Timestamp.fromMillis(now)});
  const corrupt=[
    [row(a,id(a,b)),{peerExpiresAtMs:now-1}],
    [row(a,id(a,c),'selfDeclared'),{peerExpiresAtMs:now+minute}],
    [row(a,id(a,f)),{peerExpiresAtMs:now+minute}],
    [row(a,id(a,'missing')),{peerExpiresAtMs:now+minute}],
    [row(c,id(a,b)),{peerExpiresAtMs:now+minute}]
  ];
  for(const [path,data] of corrupt)setup.set(db.doc(path),data);
  const unrelated=db.doc('unrelated/root/legacy/item');
  setup.set(unrelated,{fixture:true});
  await setup.commit();

  await check('carga inicial fechada e retomavel, rollback de pagina e comparacao bilateral exata',async()=>{
    assert.deepEqual(await http(a),{status:503,body:{error:'inbox_unavailable'}});
    await control().set({ready:true,schema:INBOX_DISCOVERY_SCHEMA});
    assert.equal((await http(a)).status,503);
    const start=await beginInboxBackfill(db,'seed-generation');
    assert.equal((await control().get()).get('ready'),false);
    assert.equal((await http(a,null,{enabled:false})).status,503);
    await assert.rejects(writeInboxBlock(db,command('during-bootstrap',a,b,true)),/inbox_not_certified/);
    assert.equal((await db.doc(blockPath(a,b)).get()).exists,false);
    await assert.rejects(beginInboxBackfill(db,'another-seed'),/inbox_maintenance_active/);

    const interrupted={
      doc:path=>db.doc(path),collection:path=>db.collection(path),
      collectionGroup:path=>db.collectionGroup(path),
      runTransaction:run=>db.runTransaction(async tx=>{
        await run(tx);
        throw Error('rollback fixture');
      })
    };
    await assert.rejects(advanceInboxMaintenance(interrupted,start.id,{limit:3}),/rollback fixture/);
    assert.deepEqual(await readRows(),Object.fromEntries(corrupt));
    assert.deepEqual(await beginInboxBackfill(db,start.id),start);
    const first=await advanceInboxMaintenance(db,start.id,{limit:3});
    assert.equal(first.chatsScanned,3);
    assert.ok(first.after);
    assert.deepEqual(await beginInboxBackfill(db,start.id),first);
    const result=await finish(start.id);
    assert.equal(result.cutAtMs,start.cutAtMs);
    assert.equal(result.chatsScanned,visiblePairs.length+blockedPairs.length);
    assert.ok(result.rowsScanned>=visiblePairs.length*2);
    assert.deepEqual((await control().get()).get('certificate'),{
      operationId:start.id,cutAtMs:start.cutAtMs,boundaryEpoch:start.boundaryEpoch
    });
    assert.deepEqual(await readRows(),expectedRows(visiblePairs));
    assert.equal((await unrelated.get()).exists,true);
    assert.deepEqual(await advanceInboxMaintenance(db,start.id),result);
    assert.deepEqual(await traverse(a),[b,c,d]);
  });
  await check('bloqueios nas duas direcoes atomicos, desbloqueio parcial e replay fora de ordem',async()=>{
    const first=(await http(a)).body;
    const ab=command('block-ab',a,b,true);
    await writeInboxBlock(db,ab);
    assert.equal((await db.doc(blockPath(a,b)).get()).exists,true);
    assert.deepEqual(await readRows(),expectedRows(visiblePairs.filter(pair=>id(...pair)!==id(a,b))));
    assert.deepEqual(await http(a,first.nextCursor),{status:409,body:{error:'inbox_restart_required'}});
    await writeInboxBlock(db,command('block-ba',b,a,true));
    const whileBlocked=(await http(a)).body;
    await writeInboxBlock(db,command('unblock-ab',a,b,false,ab.operationId));
    assert.equal((await db.doc(blockPath(b,a)).get()).exists,true);
    assert.equal((await http(a,whileBlocked.nextCursor)).status,200);
    assert.equal((await db.doc(row(b,id(a,b))).get()).exists,false);
    await writeInboxBlock(db,command('unblock-ba',b,a,false,'block-ba'));
    await writeInboxBlock(db,ab);
    await assert.rejects(writeInboxBlock(db,command('stale-block',a,b,true)),/inbox_source_changed/);
    assert.equal((await db.doc(blockPath(a,b)).get()).exists,false);
    assert.equal((await db.doc(blockPath(b,a)).get()).exists,false);
    assert.deepEqual(await readRows(),expectedRows(visiblePairs));
  });

  await check('renovacao de elegibilidade com fan-out e bloqueio concorrente fecha leitura e exige reinicio',async()=>{
    const first=await http(a);
    assert.equal(first.body.items[0].peerUid,b);
    const renewed=grant(60);
    const input={operationId:'renew-bob',uid:b,grant:renewed};
    // Os dois comandos usam o mesmo controle. Se o bloqueio ganhar a corrida,
    // deve terminar integralmente antes da manutenção.
    const blocking=command('concurrent-block',b,fanout[0],true);
    const [renewal,blocked]=await Promise.allSettled([
      beginInboxEligibilityChange(db,input),writeInboxBlock(db,blocking)
    ]);
    assert.equal(renewal.status,'fulfilled',renewal.reason?.message);
    const blockedFirst=blocked.status==='fulfilled';
    if(!blockedFirst)assert.match(blocked.reason.message,/inbox_not_certified/);
    assert.equal((await db.doc(blockPath(b,fanout[0])).get()).exists,blockedFirst);
    assert.equal((await db.doc(agePath(b)).get()).get('reviewExpiresAt').toMillis(),now+60*minute);
    assert.deepEqual(await http(a,first.body.nextCursor),{status:503,body:{error:'inbox_unavailable'}});
    const partial=await advanceInboxMaintenance(db,input.operationId,{limit:20});
    assert.equal(partial.chatsScanned,20);
    assert.equal(partial.done,false);
    assert.equal((await http(c)).status,503);
    assert.deepEqual(await beginInboxEligibilityChange(db,input),partial);
    const final=await finish(input.operationId,20);
    assert.equal(final.chatsScanned,24);
    ageByUid.set(b,renewed);
    const pairs=blockedFirst ? visiblePairs.filter(pair=>pair[1]!==fanout[0]) : visiblePairs;
    assert.deepEqual(await readRows(),expectedRows(pairs));
    assert.deepEqual(await http(a,first.body.nextCursor),{status:409,body:{error:'inbox_restart_required'}});
    assert.deepEqual(await traverse(a),[c,d,b]);
    if(blockedFirst)await writeInboxBlock(db,command('undo-race-block',b,fanout[0],false,blocking.operationId));
  });

  await check('troca de politica, revogacao e nova concessao convergem sem executar evento antigo',async()=>{
    const selfDeclared=grant(70,'selfDeclared');
    const change={operationId:'change-bob-policy',uid:b,grant:selfDeclared,expectedVersion:'renew-bob'};
    await beginInboxEligibilityChange(db,change);
    await finish(change.operationId,20);
    ageByUid.set(b,selfDeclared);
    assert.deepEqual(await readRows(),expectedRows(visiblePairs));
    assert.deepEqual(await traverse(a),[c,d]);
    const revoke={operationId:'revoke-bob',uid:b,grant:null,expectedVersion:change.operationId};
    await beginInboxEligibilityChange(db,revoke);
    await finish(revoke.operationId,20);
    ageByUid.delete(b);
    assert.equal((await db.doc(agePath(b)).get()).exists,false);
    assert.deepEqual(await readRows(),expectedRows(visiblePairs));
    assert.equal((await http(b)).status,403);
    assert.equal((await beginInboxEligibilityChange(db,change)).done,true);
    await assert.rejects(beginInboxEligibilityChange(db,{
      ...change,operationId:'late-bob-policy'
    }),/inbox_source_changed/);
    assert.equal((await db.doc(agePath(b)).get()).exists,false);

    const restore={operationId:'grant-bob',uid:b,grant:grant(15),expectedVersion:revoke.operationId};
    await beginInboxEligibilityChange(db,restore);
    await finish(restore.operationId,20);
    ageByUid.set(b,restore.grant);
    assert.deepEqual(await readRows(),expectedRows(visiblePairs));
    assert.deepEqual(await traverse(a),[b,c,d]);
  });
  await check('mudanca em politica fora da sessao nao muda cursor da politica aceita',async()=>{
    const before=(await http(a)).body;
    const grantOutsideSession=grant(75,'selfDeclared');
    await beginInboxEligibilityChange(db,{
      operationId:'renew-excluded-policy',uid:e,grant:grantOutsideSession
    });
    await finish('renew-excluded-policy');
    ageByUid.set(e,grantOutsideSession);
    assert.deepEqual(await readRows(),expectedRows(visiblePairs));
    const second=await http(a,before.nextCursor);
    assert.equal(second.status,200);
    assert.equal(second.body.items[0].peerUid,c);
  });
  await check('fronteira do checkpoint recusa escritor legado concorrente e certifica toda a fonte',async()=>{
    await env.clearFirestore();
    const low='qa-aaa';
    ageByUid.set(low,grant(40));
    const roomAB='chats/'+id(a,b), messageAB=roomAB+'/messages/initial';
    const lateId=id(low,a), lateRoom='chats/'+lateId, lateMessage=lateRoom+'/messages/contact';
    const quota='users/'+a+'/chatLimits/requests';
    const retained=blockPath(c,b);
    const seed=db.batch();
    seed.set(db.doc('app_config/conversations'),{
      enabled:true,minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1',version:'2026-11-v1'
    });
    for(const uid of [a,b,c,low])seed.set(db.doc(agePath(uid)),ageByUid.get(uid));
    seed.set(db.doc('users/'+low+'/chatSettings/privacy'),{requests:'all'});
    seed.set(db.doc(roomAB),{
      ...chat(a,b),initialId:'initial',lastMessageId:'initial',unreadRequester:0,unreadRecipient:1
    });
    seed.set(db.doc(messageAB),{uid:a,kind:'text',text:'Fixture QA',createdAt:Timestamp.fromMillis(now)});
    seed.set(db.doc('chats/'+id(a,c)),chat(a,c));
    seed.set(db.doc(retained),{createdAt:Timestamp.fromMillis(now)});
    await seed.commit();
    const actor=env.authenticatedContext(a,{email_verified:true}).firestore();
    const recipient=env.authenticatedContext(b,{email_verified:true}).firestore();
    const other=env.authenticatedContext(c,{email_verified:true}).firestore();
    const adminClaim=env.authenticatedContext(a,{email_verified:true,admin:true}).firestore();
    const firstContact=()=>{
      const batch=writeBatch(actor);
      const text='Contato fictício no checkpoint';
      batch.set(doc(actor,lateRoom),{
        participants:[a,low],requesterUid:a,recipientUid:low,status:'pending',initialId:'contact',
        lastMessageId:'contact',lastPreview:text,lastSenderUid:a,createdAt:serverTimestamp(),
        updatedAt:serverTimestamp(),unreadRequester:0,unreadRecipient:1
      });
      batch.set(doc(actor,lateMessage),{uid:a,kind:'text',text,createdAt:serverTimestamp()});
      batch.set(doc(actor,quota),{
        count:1,windowStart:serverTimestamp(),updatedAt:serverTimestamp(),lastChatId:lateId
      });
      return batch.commit();
    };
    // The exact legacy transaction is accepted with the same flags and data
    // before installing the boundary. Reset this fixture before the cut.
    await firstContact();
    assert.equal((await db.doc(lateRoom).get()).exists,true);
    const reset=db.batch();
    for(const path of [lateRoom,lateMessage,quota])reset.delete(db.doc(path));
    await reset.commit();
    const start=await beginInboxBackfill(db,'concurrent-writer-cut');
    const boundary=db.doc(INBOX_WRITE_BOUNDARY);
    assert.deepEqual((await boundary.get()).data(),{
      policy:INBOX_WRITE_POLICY,epoch:start.boundaryEpoch
    });
    const checkpoint=await advanceInboxMaintenance(db,start.id,{limit:1});
    assert.equal(checkpoint.after,id(a,b));
    assert.ok(lateId<checkpoint.after);
    assert.deepEqual(await http(a),{status:503,body:{error:'inbox_unavailable'}});
    const [next]=await Promise.all([
      advanceInboxMaintenance(db,start.id,{limit:1}),
      assertFails(firstContact()),
      assertFails(updateDoc(doc(recipient,roomAB),{unreadRecipient:0})),
      assertFails(updateDoc(doc(actor,messageAB),{reactions:{[a]:'🙏'}})),
      assertFails(setDoc(doc(actor,blockPath(a,b)),{createdAt:serverTimestamp()})),
      assertFails(deleteDoc(doc(other,retained))),
      assertFails(updateDoc(doc(adminClaim,agePath(a)),{minimumAge:21})),
      assertFails(deleteDoc(doc(adminClaim,INBOX_WRITE_BOUNDARY)))
    ]);
    assert.equal(next.chatsScanned,2);
    for(const path of [lateRoom,lateMessage,quota,blockPath(a,b)])
      assert.equal((await db.doc(path).get()).exists,false);
    assert.equal((await db.doc(retained).get()).exists,true);
    assert.equal((await db.doc(roomAB).get()).get('unreadRecipient'),1);
    assert.equal((await db.doc(messageAB).get()).get('reactions'),undefined);
    assert.equal((await db.doc(agePath(a)).get()).get('minimumAge'),18);

    // Losing the generation mid-load cannot certify the old checkpoint.
    await boundary.update({epoch:'wrong-epoch'});
    await assert.rejects(advanceInboxMaintenance(db,start.id),/inbox_write_boundary_invalid/);
    assert.deepEqual(await beginInboxBackfill(db,start.id),next);
    await boundary.update({epoch:start.boundaryEpoch});
    const finished=await finish(start.id,1);
    assert.equal(finished.chatsScanned,2);
    assert.deepEqual(await readRows(),expectedRows([[a,b],[a,c]]));
    assert.deepEqual(await traverse(a),[b,c]);
    // The write boundary survives certification and a new read can never
    // use the client's global list in this composition.
    await assertFails(firstContact());
    await assertFails(getDocsFromServer(query(collection(actor,'chats'),
      where('participants','array-contains',a),limit(20))));
    await assertFails(deleteDoc(doc(actor,roomAB)));
    await assertFails(deleteDoc(doc(actor,messageAB)));
    await assertFails(deleteDoc(doc(adminClaim,agePath(a))));
  });

  console.log('AUTHORIZED INBOX MAINTENANCE TESTS:',count,'OK');
} finally {
  await Promise.all([env.cleanup(),db.terminate()]);
}
