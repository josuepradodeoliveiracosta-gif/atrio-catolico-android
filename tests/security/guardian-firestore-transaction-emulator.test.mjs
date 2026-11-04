/** End-to-end Firestore REST transaction verification in a local Firebase Emulator.
 * Never use on production or with a real credential. All IDs are synthetic.
 */
import assert from 'node:assert/strict';
import {Firestore} from '../../cloudflare/guardian-worker/src/firestore.js';
import {guardianFreezeVerifies} from '../../cloudflare/guardian-worker/src/index.js';

if(process.env.GCLOUD_PROJECT!=='demo-atrio-v11' ||
   !['127.0.0.1:8089','localhost:8089'].includes(process.env.FIRESTORE_EMULATOR_HOST) ||
   process.env.GOOGLE_APPLICATION_CREDENTIALS ||
   process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  throw Error('guardian_transaction_qa_requires_local_emulator_only');
const db=new Firestore('owner','demo-atrio-v11','http://127.0.0.1:8089/v1');
const suffix='qa_guardian_tx_'+process.pid;
const uid='qa-guardian-tx-alice';
const marker='account_deletion_freeze/'+uid;
const records=[
  'guardian_runtime/'+suffix+'_allowed',
  'guardian_runtime/'+suffix+'_blocked',
  'guardian_runtime/'+suffix+'_source',
  'guardian_runtime/'+suffix+'_edited',
  'guardian_runtime/'+suffix+'_consistent'
];
const doc=(path,fields={status:{stringValue:'qa'}})=>({
 update:{name:db.resource+'/'+path,fields},currentDocument:{exists:false}
});
async function remove(path){
 await db.commit([{delete:db.resource+'/'+path}]);
}
async function expectConflict(work){
 await assert.rejects(work,e=>e?.status===409);
}
async function main(){
 try{
   for(const path of [...records,marker])await remove(path);
   // Missing marker is read *inside* the transaction, then the writing succeeds.
   await db.commit([doc(records[0]),...guardianFreezeVerifies(db,[uid])]);
   assert.ok(await db.get(records[0]),'missing marker allows QA-only write');

   await db.create(marker,{status:{stringValue:'draining'}});
   await expectConflict(()=>db.commit([
     doc(records[1]),...guardianFreezeVerifies(db,[uid])
   ]));
   assert.equal(await db.get(records[1]),null,'frozen account must create no notice');
   await remove(marker);

   await db.create(records[2],{status:{stringValue:'old'}});
   const original=await db.get(records[2]);
   assert.ok(original?.updateTime);
   await db.update(records[2],{status:{stringValue:'edited'}},original.updateTime);
   await expectConflict(()=>db.commit([
     doc(records[3]),
     {verify:db.resource+'/'+records[2],currentDocument:{updateTime:original.updateTime}}
   ]));
   assert.equal(await db.get(records[3]),null,'stale version must not cause partial write');

   const latest=await db.get(records[2]);
   await db.commit([
     doc(records[4]),
     {verify:db.resource+'/'+records[2],currentDocument:{updateTime:latest.updateTime}},
     ...guardianFreezeVerifies(db,[uid])
   ]);
   assert.ok(await db.get(records[4]),'same-transaction version/freeze verification works');
   console.log('guardian REST Firestore Emulator: missing marker, freeze, stale version and combined commit verified');
 }finally{
   // Only local synthetic data: even on failure, remove the QA namespace.
   await Promise.allSettled([...records,marker].map(path=>remove(path)));
 }
}
await main();
