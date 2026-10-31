/**
 * TEST ONLY — deletes hardcoded fake documents in local Firestore Emulator.
 * Never imported by Android or a Cloudflare Worker. Auth and Cloudinary are
 * in-memory Sets; journal is a temporary SQLite database.
 */
import {doc,getDoc,deleteDoc} from 'firebase/firestore';
import {assertQaReconciled} from './qa-deletion-reconciliation.mjs';
import {removeQaAuthAfterReconciliation} from './qa-deletion-auth-fence.mjs';
import {purgeQaOwnedCollections} from './qa-admin-owned-cleanup.mjs';

const PROJECT='demo-atrio-v11', HOST='127.0.0.1:8089', UID='qa-delete-alice';
const MEDIA_ID='atrio-avatares/qa-delete-alice/123e4567-e89b-42d3-a456-426614174001';
const FIXTURES=Object.freeze({
  nested:['users/'+UID+'/notifications/private1','users/'+UID+'/pushDevices/device1',
    'guardian_notices/'+UID+'/items/notice1'],
  relational:['posts/qa-delete-bob-post/replies/qa-alice-reply',
    'posts/qa-delete-alice-post','users/qa-delete-bob/notifications/qa-alice-actor'],
  roots:['profiles/'+UID,'public_profiles/'+UID,'profile_photos/'+UID,
    'users/'+UID,'guardian_notices/'+UID],
  preserved:['profiles/qa-delete-bob','posts/qa-delete-bob-post',
    'posts/qa-delete-bob-post/replies/qa-bob-reply',
    'users/qa-delete-bob/notifications/qa-bob-actor',
    'reports/qa-delete-moderation-case']
});
const STEPS=Object.freeze(['freeze_writes','remove_nested','remove_relational',
  'remove_media_stub','remove_roots','verify_fixture_absence',
  'remove_auth_stub_last','final_check']);
function fail(why){throw Error('qa_deletion_blocked:'+why);}
function guard(){
  if(process.env.FIRESTORE_EMULATOR_HOST!==HOST) fail('local_emulator_required');
  if(process.env.GCLOUD_PROJECT!==PROJECT) fail('demo_project_required');
  if(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    fail('real_service_credentials_present');
}
async function exists(db,path){return (await getDoc(doc(db,path))).exists();}
async function absent(db,paths){
  for(const path of paths)if(await exists(db,path)) return false;
  return true;
}
async function remove(db,paths,assertLease){
  for(const path of paths){
    assertLease();
    await deleteDoc(doc(db,path));
  }
}
function stages(self){
  const {db,media,auth,context,external}=self;
  return {
    freeze_writes:{
      apply:async assertLease=>{assertLease();context.writesFrozen=true;},
      verify:async()=>context.writesFrozen===true},
    remove_nested:{
      apply:async assertLease=>purgeQaOwnedCollections({
        uid:UID,db,assertLease
      }),
      verify:async()=>absent(db,FIXTURES.nested)},
    remove_relational:{
      apply:async assertLease=>remove(db,FIXTURES.relational,assertLease),
      verify:async()=>absent(db,FIXTURES.relational)},
    remove_media_stub:{
      apply:async assertLease=>{
        assertLease();
        if(external) {
          await external.media.remove(UID,MEDIA_ID);
          assertLease();
        }
        media.delete(MEDIA_ID);
      },
      verify:async()=>!media.has(MEDIA_ID) &&
        (!external || await external.media.exists(UID,MEDIA_ID)===false)},
    remove_roots:{
      apply:async assertLease=>remove(db,FIXTURES.roots,assertLease),
      verify:async()=>absent(db,FIXTURES.roots)},
    verify_fixture_absence:{
      apply:async()=>{},
      verify:async()=>await absent(db,[...FIXTURES.nested,...FIXTURES.relational,
        ...FIXTURES.roots]) && !media.has(MEDIA_ID)},
    remove_auth_stub_last:{
      // Idempotent if interrupted after the mock Auth removal but before
      // the journal checkpoint. Previous data-verification phase is required.
      apply:async assertLease=>{
        assertLease();
        if(external && await external.media.exists(UID,MEDIA_ID)!==false)
          fail('remote_media_still_present');
        assertLease();
        return removeQaAuthAfterReconciliation({
          uid:UID,db,media,auth,context,assertLease,
          ...(external?{removeRemote:uid=>external.auth.remove(uid)}:{})
        });
      },
      verify:async()=>!auth.has(UID) &&
        (!external || await external.auth.exists(UID)===false)},
    final_check:{
      apply:async()=>{},
      verify:async()=>{
        if(!await absent(db,[...FIXTURES.nested,...FIXTURES.relational,
          ...FIXTURES.roots]) || media.has(MEDIA_ID) || auth.has(UID))
          return false;
        // Re-check known orphaned subcollections and cross-account UID
        // references when resuming a previously completed journal too.
        await assertQaReconciled({uid:UID,db,media,auth,context,
          expectedAuth:'absent'});
        if(external && (await external.media.exists(UID,MEDIA_ID)!==false ||
                        await external.auth.exists(UID)!==false))
          return false;
        return true;
      }}
  };
}
export class QaDeletionRunner {
  constructor({db,journal,media,auth,context={},lease=null,external=null}){
    guard();
    if(!db || typeof journal?.prepare!=='function' ||
      !(media instanceof Set) || !(auth instanceof Set))fail('invalid_fixture_adapters');
    if(lease!==null && (typeof lease.acquire!=='function' ||
      typeof lease.assertOwned!=='function' ||
      typeof lease.commitCheckpoint!=='function' ||
      typeof lease.isBoundTo!=='function' ||
      lease.isBoundTo(journal)!==true ||
      typeof lease.release!=='function'))
      fail('invalid_qa_lease');
    if(external!==null && (typeof external?.auth?.exists!=='function' ||
       typeof external?.auth?.remove!=='function' ||
       typeof external?.media?.exists!=='function' ||
       typeof external?.media?.remove!=='function'))
      fail('invalid_qa_external_adapter');
    this.db=db;this.journal=journal;this.media=media;this.auth=auth;this.context=context;
    this.lease=lease;this.external=external;
    this.stages=stages(this);
    journal.exec('CREATE TABLE IF NOT EXISTS qa_deletion_checkpoints '+
      '(step TEXT PRIMARY KEY, finished INTEGER NOT NULL CHECK(finished=1))');
  }
  completed(){
    return this.journal.prepare(
      'SELECT step FROM qa_deletion_checkpoints WHERE finished=1 ORDER BY rowid ASC'
    ).all().map(x=>x.step);
  }
  async run(options={}){
    guard();
    if(options.approved!==true)fail('explicit_qa_approval_required');
    const ownership=this.lease?.acquire();
    this.activeLease=ownership;
    const checkLease=()=>{if(this.lease)this.lease.assertOwned(ownership);};
    try{
      return await this.runExclusive(options,checkLease);
    }finally{
      if(this.lease)this.lease.release(ownership);
      this.activeLease=null;
    }
  }
  async runExclusive({failAfterEffect=null,failBeforeEffect=null,approved=false}={},checkLease=()=>{}){
    guard();
    if(approved!==true)fail('explicit_qa_approval_required');
    checkLease();
    const request=await getDoc(doc(this.db,'account_deletion_requests/'+UID));
    checkLease();
    if(!request.exists() || request.data()?.status!=='requested')
      fail('verified_request_required');
    const recorded=this.completed();
    if(recorded.some((step,i)=>step!==STEPS[i]))fail('journal_out_of_order');
    const done=new Set(recorded);
    if(!this.auth.has(UID) && !done.has('verify_fixture_absence'))
      fail('auth_missing_before_verified_data');
    // QA-only rehydration. Production requires durable write-freeze enforcement.
    if(done.has('freeze_writes'))this.context.writesFrozen=true;
    for(const step of STEPS){
      checkLease();
      const phase=this.stages[step];
      if(done.has(step)){
        if(!(await phase.verify()))fail('previous_checkpoint_invalid:'+step);
        continue;
      }
      if(step!=='freeze_writes'&&this.context.writesFrozen!==true)
        fail('new_writes_not_frozen');
      if(step===failBeforeEffect)throw Error('injected_failure_before_effect:'+step);
      await phase.apply(checkLease);
      checkLease();
      if(!(await phase.verify()))fail('phase_verification_failed:'+step);
      checkLease();
      if(step===failAfterEffect)throw Error('injected_failure_after_effect:'+step);
      // A leased checkpoint is written atomically with the fencing check.
      checkLease();
      if(this.lease)this.lease.commitCheckpoint(this.activeLease,step);
      else this.journal.prepare(
        'INSERT INTO qa_deletion_checkpoints (step,finished) VALUES (?,1)'
      ).run(step);
      done.add(step);
    }
    return {state:'qa_fixture_cleaned_only',completed:[...done],
      productionReady:false,publicAccountDeleted:false};
  }
}
export const QA_FIXTURES=FIXTURES;
export const QA_MEDIA_ID=MEDIA_ID;
export const QA_STEPS=STEPS;
