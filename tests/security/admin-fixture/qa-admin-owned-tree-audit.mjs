/**
 * QA ONLY — Firebase Admin SDK independent deep-tree absence audit.
 *
 * Firestore document deletion never deletes descendants. This assertion
 * checks owned roots and every discovered subcollection (including
 * descendant documents with missing parent). It never deletes anything,
 * handles only exact synthetic UIDs and runs ONLY against local emulators.
 * Production IAM, non-owned references and legal retention are NOT covered.
 */
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {OWNED_ROOTS}
  from '../../../cloudflare/account-deletion-audit/src/deletion-orchestrator.js';

const A='qa-delete-alice',B='qa-delete-bob';
const PROJECT='demo-atrio-v11',APP='qa-atrio-owned-tree-audit-only';
const SEGMENT=/^[A-Za-z0-9_-]{1,160}$/;
const MAX_DEPTH=12,MAX_DOCS=2000,MAX_COLLECTIONS=2000;
function deny(why){throw Error('qa_admin_owned_tree_'+why);}
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
     process.env.FIREBASE_CONFIG ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.GOOGLE_CLOUD_PROJECT ||
     process.env.GCLOUD_PROJECT_ID ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    deny('live_environment_denied');
}
function owned(uid,path){
  if(![A,B].includes(uid) || typeof path!=='string')return false;
  const parts=path.split('/');
  return parts.length>=2 && parts.length<=MAX_DEPTH &&
    parts.length%2===0 && OWNED_ROOTS.includes(parts[0]) &&
    parts[1]===uid && parts.every(p=>SEGMENT.test(p));
}
export function createQaAdminOwnedTreeAudit(){
  guard();
  const app=initializeApp({projectId:PROJECT},APP);
  const db=getFirestore(app);
  let closed=false;
  const ready=()=>{guard();if(closed)deny('disposed');};
  return Object.freeze({
    async assertEmpty(uid){
      ready();
      if(uid!==A)deny('other_account_audit_denied');
      const queue=OWNED_ROOTS.map(root=>db.doc(root+'/'+uid));
      const seen=new Set();
      let collectionCount=0;
      for(let index=0;index<queue.length;index++){
        ready();
        const ref=queue[index];
        if(!owned(uid,ref.path)||seen.has(ref.path))
          deny('unexpected_document_path');
        seen.add(ref.path);
        if(seen.size>MAX_DOCS)deny('document_limit');
        const snap=await ref.get();
        ready();
        if(snap.exists)deny('residual_owned_document');
        // Admin listCollections and listDocuments work for missing parents,
        // therefore detect grandchildren even when all ancestors are absent.
        const children=await ref.listCollections();
        ready();
        if(!Array.isArray(children))deny('invalid_collection_result');
        for(const collection of children){
          if(!collection?.path?.startsWith(ref.path+'/') ||
             collection.path.split('/').length!==ref.path.split('/').length+1 ||
             !SEGMENT.test(collection.id))
            deny('unexpected_collection_path');
          if(++collectionCount>MAX_COLLECTIONS)
            deny('collection_limit');
          if(ref.path.split('/').length>=MAX_DEPTH)
            deny('depth_limit');
          const docs=await collection.listDocuments();
          ready();
          if(!Array.isArray(docs))deny('invalid_documents_result');
          if(docs.length+queue.length>MAX_DOCS)deny('document_limit');
          for(const child of docs){
            if(!owned(uid,child?.path)||
               !child.path.startsWith(collection.path+'/') ||
               child.path.split('/').length!==ref.path.split('/').length+2)
              deny('unexpected_document_path');
            queue.push(child);
          }
        }
      }
      ready();
      return true;
    },
    async close(){
      if(!closed){closed=true;await deleteApp(app);}
    }
  });
}
