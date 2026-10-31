/**
 * QA ONLY. SQLite lease with a monotonic fencing generation, stored on disk
 * for TEST PROCESS RESTARTS, never Cloudflare D1, never Firebase production.
 * No public endpoints or any code for deleting accounts.
 *
 * An expired lease may be taken by another runner. A displaced runner must
 * reject checkpoint writes even if its asynchronous effect already started.
 */
import {randomUUID} from 'node:crypto';

const KEY='qa-delete-alice';
const TTL_MIN=100,TTL_MAX=120000;

export class QaSqliteLease {
  constructor(database,{now=Date.now}={}){
    if(typeof database?.prepare!=='function'||
       typeof database?.exec!=='function'||typeof now!=='function')
      throw Error('invalid_qa_lease_store');
    this.db=database;this.now=now;
    database.exec('CREATE TABLE IF NOT EXISTS qa_deletion_lease ('+
      'key TEXT PRIMARY KEY, token TEXT NOT NULL, generation INTEGER NOT NULL,'+
      'expires_at INTEGER NOT NULL)');
  }
  acquire({ttlMs=15000}={}){
    if(!Number.isSafeInteger(ttlMs)||ttlMs<TTL_MIN||ttlMs>TTL_MAX)
      throw Error('invalid_qa_lease_ttl');
    const now=this.now();
    if(!Number.isSafeInteger(now)||now<0)throw Error('invalid_qa_clock');
    const token=randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const previous=this.db.prepare(
        'SELECT token,generation,expires_at FROM qa_deletion_lease WHERE key=?'
      ).get(KEY);
      if(previous && previous.expires_at>now)
        throw Error('qa_lease_busy');
      const generation=(previous?.generation||0)+1;
      if(!Number.isSafeInteger(generation)) throw Error('qa_lease_generation_exhausted');
      this.db.prepare('INSERT INTO qa_deletion_lease (key,token,generation,expires_at) '+
        'VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET '+
        'token=excluded.token,generation=excluded.generation,expires_at=excluded.expires_at'
      ).run(KEY,token,generation,now+ttlMs);
      this.db.exec('COMMIT');
      return Object.freeze({token,generation});
    }catch(error){
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  assertOwned(lease){
    if(!lease||typeof lease.token!=='string'||
       !Number.isSafeInteger(lease.generation))
      throw Error('qa_lease_invalid');
    const record=this.db.prepare(
      'SELECT token,generation,expires_at FROM qa_deletion_lease WHERE key=?'
    ).get(KEY);
    if(!record||record.token!==lease.token||
       record.generation!==lease.generation||
       record.expires_at<=this.now())
      throw Error('qa_lease_lost');
  }
  renew(lease,{ttlMs=15000}={}){
    if(!Number.isSafeInteger(ttlMs)||ttlMs<TTL_MIN||ttlMs>TTL_MAX)
      throw Error('invalid_qa_lease_ttl');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.assertOwned(lease);
      const now=this.now();
      this.db.prepare(
        'UPDATE qa_deletion_lease SET expires_at=? WHERE key=? AND token=? AND generation=?'
      ).run(now+ttlMs,KEY,lease.token,lease.generation);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  // The lease check and checkpoint are committed under the same SQLite
  // IMMEDIATE write transaction: a superseded worker cannot journal success.
  commitCheckpoint(lease,step){
    if(typeof step!=='string' || !/^[a-z_]{3,64}$/.test(step))
      throw Error('invalid_qa_checkpoint');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.assertOwned(lease);
      this.db.prepare('INSERT INTO qa_deletion_checkpoints (step,finished) VALUES (?,1)')
        .run(step);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  isBoundTo(database){return database===this.db;}
  release(lease){
    if(!lease||typeof lease.token!=='string'||
       !Number.isSafeInteger(lease.generation))return;
    this.db.prepare(
      'DELETE FROM qa_deletion_lease WHERE key=? AND token=? AND generation=?'
    ).run(KEY,lease.token,lease.generation);
  }
}
