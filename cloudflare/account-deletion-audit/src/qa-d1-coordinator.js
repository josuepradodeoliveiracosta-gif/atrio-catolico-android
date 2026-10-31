/**
 * QA-ONLY D1-compatible coordinator. No routes, cron, Worker binding,
 * account deletion, media deletion, or production UID arguments.
 *
 * Ownership transitions are single conditional SQL statements: a stale
 * runner cannot acknowledge a stage after another runner takes over.
 * Verification callbacks are for fake QA resources, not real services.
 */
import {randomUUID} from 'node:crypto';

const FIXTURE='qa-delete-alice';
const TTL_MIN=1000,TTL_MAX=60000;
const PHASES=Object.freeze([
  'freeze_writes','remove_nested','remove_relational','remove_media_stub',
  'remove_roots','verify_fixture_absence','remove_auth_stub_last','final_check'
]);
const ACQUIRE=[
  'INSERT INTO qa_privacy_runs',
  '(fixture,lease_token,generation,lease_expires_at,last_step,updated_at)',
  'VALUES (?, ?, 1, ?, 0, ?)',
  'ON CONFLICT(fixture) DO UPDATE SET',
  'lease_token=excluded.lease_token,',
  'generation=qa_privacy_runs.generation+1,',
  'lease_expires_at=excluded.lease_expires_at,',
  'updated_at=excluded.updated_at',
  'WHERE qa_privacy_runs.lease_expires_at <= excluded.updated_at',
  'AND qa_privacy_runs.last_step < 8',
  'RETURNING generation,last_step'
].join(' ');
const ACK=[
  'UPDATE qa_privacy_runs SET last_step=?, updated_at=?',
  'WHERE fixture=? AND lease_token=? AND generation=?',
  'AND lease_expires_at>? AND last_step=? RETURNING last_step'
].join(' ');
const RENEW=[
  'UPDATE qa_privacy_runs SET lease_expires_at=?, updated_at=?',
  'WHERE fixture=? AND lease_token=? AND generation=? AND lease_expires_at>?',
  'RETURNING generation'
].join(' ');
const RELEASE=[
  "UPDATE qa_privacy_runs SET lease_expires_at=0,lease_token='released',updated_at=?",
  'WHERE fixture=? AND lease_token=? AND generation=? RETURNING generation'
].join(' ');
const STATUS=[
  'SELECT last_step,lease_expires_at',
  'FROM qa_privacy_runs WHERE fixture=?'
].join(' ');

function numericTime(now){
  const value=now();
  if(!Number.isSafeInteger(value)||value<=0)throw Error('qa_invalid_clock');
  return value;
}
function ttl(ttlMs){
  if(!Number.isSafeInteger(ttlMs)||ttlMs<TTL_MIN||ttlMs>TTL_MAX)
    throw Error('qa_invalid_ttl');
}
function leaseShape(lease){
  return lease && typeof lease.token==='string' &&
    /^[0-9a-f-]{36}$/.test(lease.token) &&
    Number.isSafeInteger(lease.generation) && lease.generation>0;
}
async function first(db,sql,...values){
  const row=await db.prepare(sql).bind(...values).first();
  return row||null;
}
export function createQaD1Coordinator(db,{now=Date.now}={}){
  if(typeof db?.prepare!=='function'||typeof now!=='function')
    throw Error('qa_invalid_d1_binding');
  return Object.freeze({
    async acquire({ttlMs=15000}={}){
      ttl(ttlMs);
      const time=numericTime(now);
      const token=randomUUID();
      const row=await first(db,ACQUIRE,FIXTURE,token,time+ttlMs,time);
      if(!row)throw Error('qa_busy_or_already_complete');
      return Object.freeze({token,generation:row.generation,lastStep:row.last_step});
    },
    async renew(lease,{ttlMs=15000}={}){
      if(!leaseShape(lease))throw Error('qa_invalid_lease');
      ttl(ttlMs);
      const time=numericTime(now);
      const row=await first(db,RENEW,time+ttlMs,time,FIXTURE,lease.token,
        lease.generation,time);
      if(!row)throw Error('qa_stale_lease');
      return true;
    },
    async acknowledge(lease,phase,{verified}={}){
      if(!leaseShape(lease))throw Error('qa_invalid_lease');
      const index=PHASES.indexOf(phase);
      if(index<0)throw Error('qa_unknown_phase');
      if(typeof verified!=='function')throw Error('qa_verification_missing');
      if(await verified()!==true)throw Error('qa_phase_unverified');
      const time=numericTime(now);
      const row=await first(db,ACK,index+1,time,FIXTURE,lease.token,
        lease.generation,time,index);
      if(!row)throw Error('qa_stale_or_out_of_order');
      return Object.freeze({lastStep:row.last_step,phase});
    },
    async release(lease){
      if(!leaseShape(lease))return false;
      const row=await first(db,RELEASE,numericTime(now),FIXTURE,
        lease.token,lease.generation);
      return Boolean(row);
    },
    async status(){
      const row=await first(db,STATUS,FIXTURE);
      if(!row)return Object.freeze({exists:false,phaseCount:0,completed:false});
      return Object.freeze({
        exists:true,phaseCount:row.last_step,completed:row.last_step===PHASES.length,
        leased:row.lease_expires_at>numericTime(now)
      });
    }
  });
}
export const QA_D1_PHASES=PHASES;
