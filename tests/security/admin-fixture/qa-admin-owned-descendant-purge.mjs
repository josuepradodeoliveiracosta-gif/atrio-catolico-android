/**
 * QA ONLY — actual recursive Firestore Admin SDK deletion against the
 * local Firebase Emulator. This removes OWNED DESCENDANTS only; never the
 * owner root, shared/third-party records, Auth, Cloudinary, D1 or legal cases.
 *
 * Inventories every level, including orphan documents with missing parents,
 * BEFORE the first mutation. No production endpoint imports this module.
 * Real IAM, fencing across Workers and human authorization remain missing.
 */
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {OWNED_ROOTS}
  from '../../../cloudflare/account-deletion-audit/src/deletion-orchestrator.js';

const UID='qa-delete-alice';
const PROJECT='demo-atrio-v11',HOST='127.0.0.1:8089';
const APP='qa-atrio-owned-descendant-purge-only';
const SEGMENT=/^[A-Za-z0-9_-]{1,160}$/;
const MAX_DEPTH=12,MAX_DOCS=2000,MAX_COLLECTIONS=2000;

function deny(why){throw Error('qa_owned_descendant_purge_'+why);}
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
    process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
    process.env.FIREBASE_CONFIG ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID ||
    process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_KEY ||
    process.env.CLOUDINARY_CLOUD_NAME ||
    process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('live_environment_denied');
}
function belongsToOwner(uid,path){
  if(uid!==UID || typeof path!=='string')return false;
  const parts=path.split('/');
  return parts.length>=2 && parts.length<=MAX_DEPTH &&
    parts.length%2===0 && OWNED_ROOTS.includes(parts[0]) &&
    parts[1]===uid && parts.every(p=>SEGMENT.test(p));
}
function isDescendant(ref,uid){
  return belongsToOwner(uid,ref?.path) && ref.path.split('/').length>2;
}
async function inventory(db,uid,ready){
  const queue=OWNED_ROOTS.map(root=>db.doc(root+'/'+uid));
  const seen=new Set(),docs=[];
  let collections=0;
  for(let i=0;i<queue.length;i++){
    ready();
    const parent=queue[i];
    if(!belongsToOwner(uid,parent?.path) || seen.has(parent.path))
      deny('unexpected_or_duplicate_path');
    seen.add(parent.path);
    if(seen.size>MAX_DOCS)deny('document_limit');
    const children=await parent.listCollections();
    ready();
    if(!Array.isArray(children))deny('invalid_collection_result');
    for(const col of children){
      if(col?.path!==parent.path+'/'+col?.id || !SEGMENT.test(col.id) ||
        col.path.split('/').length!==parent.path.split('/').length+1)
        deny('unexpected_collection_path');
      if(++collections>MAX_COLLECTIONS)deny('collection_limit');
      if(parent.path.split('/').length>=MAX_DEPTH)
        deny('depth_limit');
      const refs=await col.listDocuments();
      ready();
      if(!Array.isArray(refs))deny('invalid_document_result');
      if(refs.length+queue.length>MAX_DOCS)deny('document_limit');
      for(const ref of refs){
        if(!isDescendant(ref,uid) || !ref.path.startsWith(col.path+'/') ||
          ref.path.split('/').length!==col.path.split('/').length+1)
          deny('cross_account_document_denied');
        docs.push(ref);
        queue.push(ref);
      }
    }
  }
  if(docs.length>MAX_DOCS)deny('document_limit');
  return docs;
}
export function createQaAdminOwnedDescendantPurger(){
  guard();
  const app=initializeApp({projectId:PROJECT},APP);
  const db=getFirestore(app);
  let closed=false;
  const ready=()=>{guard();if(closed)deny('disposed');};
  return Object.freeze({
    async purge(uid,{assertAuthorized,assertLease}={}){
      ready();
      if(uid!==UID)deny('other_account_denied');
      if(typeof assertAuthorized!=='function' || typeof assertLease!=='function')
        deny('fence_and_authorization_required');
      async function fenced(){
        ready();
        if(await assertAuthorized()!==true)deny('authorization_lost');
        // Lease check may be asynchronous. A rejected Promise or a false
        // return must not permit a privileged Firestore deletion.
        const leaseValid=await assertLease();
        // A missing/undefined lease is NOT authorization, even for legacy
        // throw-on-loss callbacks. Every destructive call must prove true.
        if(leaseValid!==true)deny('lease_lost');
        ready();
      }
      await fenced();
      // Full, bounded enumeration before any deletion prevents accidental
      // partial removal when an unexpected subtree exceeds safety limits.
      const found=await inventory(db,uid,ready);
      await fenced();
      // An orphan grandchild or previously unknown subtree may have
      // appeared during the asynchronous traversal. Stop BEFORE the first
      // destructive call when the owner tree changed since inventory.
      // Individual Firestore lastUpdateTime checks still protect subsequent
      // races and any partial failure requires a new reviewed inventory.
      const latest=await inventory(db,uid,ready);
      const paths=docs=>docs.map(x=>x.path).sort();
      if(JSON.stringify(paths(found))!==JSON.stringify(paths(latest)))
        deny('precommit_tree_changed');
      found.sort((a,b)=>b.path.split('/').length-a.path.split('/').length ||
        a.path.localeCompare(b.path));
      for(const ref of found){
        await fenced();
        // Confirm this exact object remains inside the owned UID namespace.
        if(!isDescendant(ref,uid))deny('cross_account_document_denied');
        // A descendant's content or owner may change during the long
        // recursive scan. Delete only the revision we actually inspected.
        const fresh=await ref.get();
        await fenced();
        if(!fresh.exists)continue; // legitimate orphan parent or retry
        if(!fresh.updateTime || !Number.isFinite(
          fresh.updateTime.toMillis?.()))
          deny('missing_document_version');
        try{
          await ref.delete({lastUpdateTime:fresh.updateTime});
        }catch(error){
          // Concurrent edits are not authorization to erase newer data.
          if(error?.code===9||error?.code==='failed-precondition'||
             /FAILED_PRECONDITION|precondition failed/i.test(
               String(error?.message||'')))
            deny('concurrent_owned_document_changed');
          throw error;
        }
        await fenced();
      }
      const remaining=await inventory(db,uid,ready);
      await fenced();
      if(remaining.length!==0)deny('residual_owned_descendants');
      return Object.freeze({state:'qa_owned_descendants_purged',
        deletedCount:found.length,productionReady:false});
    },
    async close(){if(!closed){closed=true;await deleteApp(app);}}
  });
}
