/**
 * QA ONLY — validate the actual Avatar Worker's D1 SQL against the
 * already-admitted route owner/actor. Never use this as an IAM guard or deploy
 * in production. No live secrets or network access.
 *
 * This gate prevents a route ticket for Alice from authorizing a D1 mutation
 * to Bob. Unrecognized SQL fails before prepare(), even if an older Worker
 * starts to issue a new write without updating the QA review contract.
 */
const IDS=new Set(['qa-freeze-alice','qa-freeze-bob']);
const fail=what=>{throw Error('qa_avatar_d1_'+what);};
const normalized=sql=>typeof sql==='string'?sql.trim().replace(/\s+/g,' '):'';
const readonly=new Map([
 ['SELECT public_id FROM avatar_pending WHERE uid=?','pending']
]);
const mutating=new Map([
 ['INSERT INTO avatar_mutex (uid,nonce,expires_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET nonce=excluded.nonce,expires_at=excluded.expires_at WHERE avatar_mutex.expires_at < ?','mutex_acquire'],
 ['DELETE FROM avatar_mutex WHERE uid=? AND nonce=?','mutex_release'],
 ['INSERT INTO avatar_rate (uid,next_at) VALUES (?,?) ON CONFLICT(uid) DO UPDATE SET next_at=excluded.next_at WHERE avatar_rate.next_at <= ?','rate'],
 ['INSERT INTO avatar_pending (uid,public_id,created_at) VALUES (?,?,?) ON CONFLICT(uid) DO UPDATE SET public_id=excluded.public_id, created_at=excluded.created_at','pending_write'],
 ['DELETE FROM avatar_pending WHERE uid=? AND public_id=?','pending_delete_if'],
 ['DELETE FROM avatar_pending WHERE uid=?','pending_delete'],
 ['INSERT INTO avatar_moderation (actor_uid,target_uid,reason,created_at) VALUES (?,?,?,?)','moderation']
]);
const validId=(uid,id)=>typeof id==='string' &&
  /^atrio-avatares\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/.test(id) &&
  id.startsWith('atrio-avatares/'+uid+'/');
const isTime=x=>Number.isSafeInteger(x)&&x>=0;
function check(kind,args,owner,actor){
  const bad=()=>fail('identity_or_parameters_denied');
  if(!Array.isArray(args) || args[0]!==owner && kind!=='moderation')bad();
  switch(kind){
    case 'pending':
    case 'pending_delete':
      if(args.length!==1)bad();
      return;
    case 'pending_delete_if':
      if(args.length!==2||!validId(owner,args[1]))bad();
      return;
    case 'pending_write':
      if(args.length!==3||!validId(owner,args[1])||!isTime(args[2]))bad();
      return;
    case 'mutex_acquire':
      if(args.length!==4||!isTime(args[2])||!isTime(args[3])||
         typeof args[1]!=='string' ||
         !/^[a-f0-9-]{36}$/.test(args[1]))bad();
      return;
    case 'mutex_release':
      if(args.length!==2||typeof args[1]!=='string'||
         !/^[a-f0-9-]{36}$/.test(args[1]))bad();
      return;
    case 'rate':
      if(args.length!==3||!isTime(args[1])||!isTime(args[2]))bad();
      return;
    case 'moderation':
      if(args.length!==4||args[0]!==actor||args[1]!==owner||
         actor===owner||!IDS.has(actor)||
         typeof args[2]!=='string'||args[2].length<5 ||
         args[2].length>130 || !isTime(args[3]))bad();
      return;
    default:fail('unrecognized_statement');
  }
}
export function createQaAvatarD1Binding({db,scope,kind}={}){
  const owner=scope?.ownerUid,actor=scope?.actorUid??owner;
  if(!IDS.has(owner)||!IDS.has(actor)||!mutating.size||
     !['avatar_upload','avatar_promote','avatar_remove','avatar_moderation'].includes(kind) ||
     typeof db?.prepare!=='function'||
     (kind==='avatar_moderation' ? actor===owner : actor!==owner))
    fail('invalid_route_context');
  return Object.freeze({
    prepare(raw){
      const statement=normalized(raw);
      const type=readonly.get(statement)||mutating.get(statement);
      if(!type)fail('unreviewed_sql');
      return Object.freeze({
        bind(...args){
          check(type,args,owner,actor);
          const prepared=db.prepare(raw).bind(...args);
          return Object.freeze({
            async first(){
              if(!readonly.has(statement))fail('wrong_method');
              return prepared.first();
            },
            async run(){
              if(!mutating.has(statement))fail('wrong_method');
              return prepared.run();
            },
            async all(){fail('unreviewed_read_method');}
          });
        }
      });
    }
  });
}
export const QA_AVATAR_D1_READINESS=Object.freeze({
  productionIntegrated:false,
  noRealIam:true,
  allowlistedStatements:mutating.size,
  noUncheckedSql:true
});
