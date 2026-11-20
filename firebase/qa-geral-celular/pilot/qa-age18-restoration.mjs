// Somente servidor administrativo QA; nenhuma credencial ou rota pública.
// Transações Firestore serializam consumo/revogação, inclusive sob concorrência.
import {randomUUID} from 'node:crypto';
const POLICY='2026-11-18plus-qa-v1';
const ms=v=>v?.toMillis?.()??(v instanceof Date?v.getTime():NaN);
const id=v=>typeof v==='string' && /^[A-Za-z0-9_-]{8,128}$/.test(v);
export function createQaAge18Restoration({
  db,serverTimestamp,authorize,identity,now=()=>Date.now(),uuid=randomUUID,
}) {
  if(!db?.runTransaction||typeof serverTimestamp!=='function'||
     typeof authorize!=='function'||!identity?.accounts)
    throw Error('age18_service_configuration_required');
  const allowed=(principal,capability)=>{
    if(typeof principal!=='string'||authorize(principal,capability)!==true)
      throw Error('operator_forbidden');
  };
  const checkUid=uid=>{
    if(!Object.hasOwn(identity.accounts,uid)) throw Error('uid_not_allowed');
  };
  const tokenRef=tokenId=>db.doc('qaAge18RestorationAuthorizations/'+tokenId);
  const proofRef=uid=>db.doc('users/'+uid+'/chatAgeEligibility/current');
  const stateRef=uid=>db.doc('users/'+uid+'/chatAgeRestorationState/current');
  const expiry=value=>{
    if(!(value instanceof Date)||!Number.isFinite(value.getTime())||value.getTime()<=now())
      throw Error('invalid_expiry');
  };
  async function issue({uid,principal,expiresAt,reviewExpiresAt}) {
    allowed(principal,'manage_age18_restoration');
    checkUid(uid);expiry(expiresAt);expiry(reviewExpiresAt);
    const tokenId=uuid();
    if(!id(tokenId)) throw Error('invalid_authorization_id');
    await db.runTransaction(async tx=>{
      const state=await tx.get(stateRef(uid));
      tx.create(tokenRef(tokenId),{
        uid,status:'issued',policyVersion:POLICY,issuedBy:principal,
        expiresAt,reviewExpiresAt,
        epoch:state.data()?.epoch??null,createdAt:serverTimestamp(),
      });
    });
    return {tokenId};
  }
  async function consume({uid,tokenId,principal}) {
    allowed(principal,'consume_age18_restoration');
    checkUid(uid);
    if(!id(tokenId)) throw Error('invalid_authorization_id');
    return db.runTransaction(async tx=>{
      const [ticket,state]=await Promise.all([tx.get(tokenRef(tokenId)),tx.get(stateRef(uid))]);
      const data=ticket.data();
      if(!ticket.exists||data.uid!==uid||data.policyVersion!==POLICY||
        data.status!=='issued'||ms(data.expiresAt)<=now()||
        data.epoch!==(state.data()?.epoch??null))
        throw Error('age18_authorization_unavailable');
      if(ms(data.reviewExpiresAt)<=now()) throw Error('age18_authorization_unavailable');
      tx.update(tokenRef(tokenId),{
        status:'consumed',consumedBy:principal,consumedAt:serverTimestamp(),
      });
      tx.set(proofRef(uid),{
        status:'eligible',minimumAge:18,policyVersion:POLICY,
        reviewExpiresAt:data.reviewExpiresAt,
      });
      tx.set(stateRef(uid),{
        epoch:uuid(),lastTokenId:tokenId,lastStatus:'consumed',
        updatedAt:serverTimestamp(),
      });
      return {restored:true};
    });
  }
  async function revoke({uid,tokenId,principal}) {
    allowed(principal,'manage_age18_restoration');
    checkUid(uid);
    if(!id(tokenId)) throw Error('invalid_authorization_id');
    return db.runTransaction(async tx=>{
      const [ticket,state,proof]=await Promise.all([
        tx.get(tokenRef(tokenId)),tx.get(stateRef(uid)),tx.get(proofRef(uid)),
      ]);
      if(!ticket.exists||ticket.data().uid!==uid) throw Error('age18_authorization_unavailable');
      const old=ticket.data();
      if(old.status==='revoked') return {revoked:true,replay:true};
      // Mesmo se o consumo vencer a corrida, a revogação subsequente
      // derruba a elegibilidade restaurada por ESTE token.
      tx.update(tokenRef(tokenId),{
        status:'revoked',revokedBy:principal,revokedAt:serverTimestamp(),
      });
      const generation=uuid();
      tx.set(stateRef(uid),{
        epoch:generation,lastTokenId:tokenId,lastStatus:'revoked',
        updatedAt:serverTimestamp(),
      });
      if(old.status==='consumed'&&state.data()?.lastTokenId===tokenId&&
         proof.data()?.status==='eligible')
        tx.set(proofRef(uid),{
          status:'revoked',minimumAge:18,policyVersion:POLICY,
          reviewExpiresAt:new Date(0),
        });
      return {revoked:true,replay:false};
    });
  }
  return Object.freeze({issue,consume,revoke});
}
