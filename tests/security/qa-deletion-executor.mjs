/**
 * TEST ONLY — deletes hardcoded fake documents in local Firestore Emulator.
 * Never imported by Android or a Cloudflare Worker. Auth and Cloudinary are
 * in-memory Sets; journal is a temporary SQLite database.
 */
import {doc,getDoc,deleteDoc} from 'firebase/firestore';

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
async function remove(db,paths){for(const path of paths)await deleteDoc(doc(db,path));}
function stages(self){
  const {db,media,auth,context}=self;
  return {
    freeze_writes:{
      apply:async()=>{context.writesFrozen=true;},
      verify:async()=>context.writesFrozen===true},
    remove_nested:{
      apply:async()=>remove(db,FIXTURES.nested),
      verify:async()=>absent(db,FIXTURES.nested)},
    remove_relational:{
      apply:async()=>remove(db,FIXTURES.relational),
      verify:async()=>absent(db,FIXTURES.relational)},
    remove_media_stub:{
      apply:async()=>{media.delete(MEDIA_ID);},
      verify:async()=>!media.has(MEDIA_ID)},
    remove_roots:{
      apply:async()=>remove(db,FIXTURES.roots),
      verify:async()=>absent(db,FIXTURES.roots)},
    verify_fixture_absence:{
      apply:async()=>{},
      verify:async()=>await absent(db,[...FIXTURES.nested,...FIXTURES.relational,
        ...FIXTURES.roots]) && !media.has(MEDIA_ID)},
    remove_auth_stub_last:{
      apply:async()=>{
        if(!auth.has(UID))fail('auth_stub_missing_before_last_phase');
        auth.delete(UID);
      },
      verify:async()=>!auth.has(UID)},
    final_check:{
      apply:async()=>{},
      verify:async()=>await absent(db,[...FIXTURES.nested,...FIXTURES.relational,
        ...FIXTURES.roots]) && !media.has(MEDIA_ID) && !auth.has(UID)}
  };
}
export class QaDeletionRunner {
  constructor({db,journal,media,auth,context={}}){
    guard();
    if(!db || typeof journal?.prepare!=='function' ||
      !(media instanceof Set) || !(auth instanceof Set))fail('invalid_fixture_adapters');
    this.db=db;this.journal=journal;this.media=media;this.auth=auth;this.context=context;
    this.stages=stages(this);
    journal.exec('CREATE TABLE IF NOT EXISTS qa_deletion_checkpoints '+
      '(step TEXT PRIMARY KEY, finished INTEGER NOT NULL CHECK(finished=1))');
  }
  completed(){
    return this.journal.prepare(
      'SELECT step FROM qa_deletion_checkpoints WHERE finished=1 ORDER BY rowid ASC'
    ).all().map(x=>x.step);
  }
  async run({failAfterEffect=null,approved=false}={}){
    guard();
    if(approved!==true)fail('explicit_qa_approval_required');
    const request=await getDoc(doc(this.db,'account_deletion_requests/'+UID));
    if(!request.exists() || request.data()?.status!=='requested')
      fail('verified_request_required');
    const recorded=this.completed();
    if(recorded.some((step,i)=>step!==STEPS[i]))fail('journal_out_of_order');
    const done=new Set(recorded);
    // QA-only rehydration. Production requires durable write-freeze enforcement.
    if(done.has('freeze_writes'))this.context.writesFrozen=true;
    for(const step of STEPS){
      const phase=this.stages[step];
      if(done.has(step)){
        if(!(await phase.verify()))fail('previous_checkpoint_invalid:'+step);
        continue;
      }
      if(step!=='freeze_writes'&&this.context.writesFrozen!==true)
        fail('new_writes_not_frozen');
      if(step==='remove_auth_stub_last'&&!this.auth.has(UID))
        fail('auth_stub_missing_before_last_phase');
      await phase.apply();
      if(!(await phase.verify()))fail('phase_verification_failed:'+step);
      if(step===failAfterEffect)throw Error('injected_failure_after_effect:'+step);
      this.journal.prepare('INSERT INTO qa_deletion_checkpoints (step,finished) VALUES (?,1)')
        .run(step);
      done.add(step);
    }
    return {state:'qa_fixture_cleaned_only',completed:[...done],
      productionReady:false,publicAccountDeleted:false};
  }
}
export const QA_FIXTURES=FIXTURES;
export const QA_MEDIA_ID=MEDIA_ID;
export const QA_STEPS=STEPS;
