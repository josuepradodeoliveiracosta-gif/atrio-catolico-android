/**
 * Operações internas do backend de QA. A janela fechada só é consistente
 * quando todos os escritores da fonte respeitam o controle de manutenção.
 * Não monta rotas, gatilhos ou credenciais.
 */
import {createHash,randomUUID} from 'node:crypto';
import {
  INBOX_AGE_COLLECTIONS,INBOX_DISCOVERY_CONTROL,INBOX_DISCOVERY_SCHEMA,
  INBOX_WRITE_BOUNDARY,INBOX_WRITE_POLICY,inboxBoundaryEpoch,
  existingPeerInboxViews,inboxAgeGrant,inboxAgePath,inboxBlockPath,
  inboxProjectionReady,preparePeerInbox,readPeerInboxAuthorization,
  writeInboxDiscoveryEntry
} from './chat-inbox-peer-index.mjs';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const phases=['chats',...Object.values(INBOX_AGE_COLLECTIONS)];
const controlRef=db=>db.doc(INBOX_DISCOVERY_CONTROL);
const receiptRef=(db,id)=>db.doc('serverInboxJobs/'+id);
const versionRef=(db,path)=>db.doc('serverInboxMutationVersions/'+
  createHash('sha256').update(path).digest('hex'));

function assertId(id) {
  if(typeof id!=='string'||!ID.test(id))throw Error('inbox_invalid_operation');
}
function assertCommand(id,expectedVersion) {
  assertId(id);
  if(expectedVersion!==null)assertId(expectedVersion);
}
function checkReplay(receipt,key) {
  if(receipt.fingerprint!==key)throw Error('inbox_operation_conflict');
  return receipt.result;
}
function expectVersion(version,expected) {
  if((version.data()?.operationId??null)!==expected)
    throw Error('inbox_source_changed');
}

export async function beginInboxBackfill(db,operationId) {
  assertId(operationId);
  return beginMaintenance(db,operationId,'bootstrap');
}

export async function beginInboxEligibilityChange(db,{
  operationId,uid,grant,expectedVersion=null
}) {
  assertCommand(operationId,expectedVersion);
  assertId(uid);
  const parsed=grant===null ? null : inboxAgeGrant(grant);
  if(grant!==null&&!parsed)throw Error('inbox_invalid_eligibility');
  return beginMaintenance(db,operationId,'eligibility',{uid,grant,parsed,expectedVersion});
}

async function beginMaintenance(db,id,kind,change=null) {
  const control=controlRef(db);
  const boundary=db.doc(INBOX_WRITE_BOUNDARY);
  const receipt=receiptRef(db,id);
  const source=change ? db.doc(inboxAgePath(change.uid)) : null;
  const version=source ? versionRef(db,source.path) : null;
  const key=JSON.stringify([
    kind,change?.uid,change?.parsed?.pair,change?.parsed?.expiresAtMs,change?.expectedVersion
  ]);
  return db.runTransaction(async tx=>{
    const [state,prior,fence]=await tx.getAll(control,receipt,boundary);
    if(prior.exists)return checkReplay(prior.data(),key);
    const legacyJob=kind==='bootstrap'&&state.data()?.schema===2&&!fence.exists;
    if(state.data()?.job&&!legacyJob)throw Error('inbox_maintenance_active');
    const epoch=inboxBoundaryEpoch(fence.data());
    if(fence.exists&&!epoch)throw Error('inbox_write_boundary_invalid');
    if(source) {
      if(!inboxProjectionReady(state.data(),fence.data()))throw Error('inbox_not_certified');
      expectVersion(await tx.get(version),change.expectedVersion);
    }
    const boundaryEpoch=epoch??randomUUID();
    const job={
      id,kind,uid:change?.uid??null,phase:'chats',after:null,done:false,
      boundaryEpoch,
      cutAtMs:state.readTime.toMillis(),chatsScanned:0,rowsScanned:0
    };
    // O mesmo commit que muda a fonte torna a descoberta indisponível.
    if(source) {
      if(change.grant===null)tx.delete(source);
      else tx.set(source,change.grant);
      tx.set(version,{operationId:id});
    }
    if(!fence.exists)tx.create(boundary,{policy:INBOX_WRITE_POLICY,epoch:boundaryEpoch});
    tx.set(control,{...state.data(),schema:INBOX_DISCOVERY_SCHEMA,ready:false,job});
    tx.create(receipt,{fingerprint:key,result:job});
    return job;
  });
}

async function prepareSweepEntry(db,tx,pair,snap) {
  const [root,uid,,chatId,...rest]=snap.ref.path.split('/');
  if(root!=='serverInboxOwners'||rest.length||!chatId)return null;
  const views=existingPeerInboxViews(await tx.get(db.doc('chats/'+chatId)));
  const position=views.findIndex(view=>view.data.ownerUid===uid);
  const grant=position<0 ? null :
    (await readPeerInboxAuthorization(db,tx,views)).grants[position];
  return ()=>writeInboxDiscoveryEntry(db,tx,{ownerUid:uid,pair,ref:snap.ref,snap},grant);
}

/**
 * Cada página usa uma transação com a projeção e seu checkpoint. Assim um
 * processo que cai pode voltar pelo ID da operação sem repetir mutações de fonte.
 */
export async function advanceInboxMaintenance(db,id,{limit=20}={}) {
  assertId(id);
  if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('inbox_invalid_batch');
  const control=controlRef(db);
  const receipt=receiptRef(db,id);
  return db.runTransaction(async tx=>{
    const [state,operation,fence]=await tx.getAll(control,receipt,db.doc(INBOX_WRITE_BOUNDARY));
    const previous=operation.data()?.result;
    if(previous?.done)return previous;
    const job=state.data()?.job;
    if(job?.id!==id||!previous||state.data().ready!==false||
       state.data().schema!==INBOX_DISCOVERY_SCHEMA)
      throw Error('inbox_maintenance_missing');
    if(!job.boundaryEpoch||inboxBoundaryEpoch(fence.data())!==job.boundaryEpoch)
      throw Error('inbox_write_boundary_invalid');
    const fromChats=job.phase==='chats';
    let query=fromChats ? db.collection('chats') : db.collectionGroup(job.phase);
    if(fromChats&&job.uid)query=query.where('participants','array-contains',job.uid);
    query=query.orderBy('__name__').limit(limit);
    if(job.after)query=query.startAfter(fromChats ? job.after : db.doc(job.after));
    const {docs}=await tx.get(query);
    const pair=Object.keys(INBOX_AGE_COLLECTIONS).find(key=>INBOX_AGE_COLLECTIONS[key]===job.phase);
    const plans=await Promise.all(docs.map(async snap=>{
      if(!fromChats)return prepareSweepEntry(db,tx,pair,snap);
      const views=existingPeerInboxViews(snap);
      return views.length ? preparePeerInbox(db,tx,views) : null;
    }));
    for(const apply of plans)apply?.();

    const next={...job};
    if(fromChats)next.chatsScanned+=docs.length;
    else next.rowsScanned+=plans.filter(Boolean).length;
    if(docs.length===limit) {
      const last=docs.at(-1);
      next.after=fromChats ? last.id : last.ref.path;
    } else {
      next.after=null;
      next.phase=job.kind==='bootstrap' ? phases[phases.indexOf(job.phase)+1]??null : null;
      next.done=next.phase===null;
    }
    const updated={...state.data(),ready:next.done,job:next.done ? null : next};
    if(next.done&&job.kind==='bootstrap')
      updated.certificate={operationId:id,cutAtMs:job.cutAtMs,boundaryEpoch:job.boundaryEpoch};
    tx.set(control,updated);
    tx.update(receipt,{result:next});
    return next;
  });
}

/** Bloqueio e ambas as projeções compartilham o commit de origem. */
export async function writeInboxBlock(db,{
  operationId,ownerUid,peerUid,blocked,createdAt=null,expectedVersion=null
}) {
  assertCommand(operationId,expectedVersion);
  assertId(ownerUid);
  assertId(peerUid);
  if(ownerUid===peerUid||typeof blocked!=='boolean'||
     (blocked&&!Number.isFinite(createdAt?.toMillis?.())))
    throw Error('inbox_invalid_block');
  const path=inboxBlockPath(ownerUid,peerUid);
  const receipt=receiptRef(db,operationId);
  const version=versionRef(db,path);
  const key=JSON.stringify(['block',path,blocked,blocked?createdAt.toMillis():null,expectedVersion]);
  return db.runTransaction(async tx=>{
    const [state,prior,currentVersion,fence]=await tx.getAll(
      controlRef(db),receipt,version,db.doc(INBOX_WRITE_BOUNDARY));
    if(prior.exists)return checkReplay(prior.data(),key);
    if(!inboxProjectionReady(state.data(),fence.data()))throw Error('inbox_not_certified');
    expectVersion(currentVersion,expectedVersion);
    const chats=await tx.getAll(
      db.doc('chats/'+ownerUid+'__'+peerUid),db.doc('chats/'+peerUid+'__'+ownerUid)
    );
    const views=chats.map(existingPeerInboxViews).filter(list=>
      list.some(v=>v.data.ownerUid===ownerUid&&v.data.peerUid===peerUid));
    const plans=await Promise.all(views.map(list=>
      preparePeerInbox(db,tx,list,{path,blocked})));
    if(blocked)tx.set(db.doc(path),{createdAt});
    else tx.delete(db.doc(path));
    for(const apply of plans)apply();
    const result={id:operationId,done:true};
    tx.set(version,{operationId});
    tx.create(receipt,{fingerprint:key,result});
    return result;
  });
}
