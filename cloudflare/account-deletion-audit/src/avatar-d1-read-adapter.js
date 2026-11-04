/**
 * D1 do Worker de avatar: adaptador SOMENTE-LEITURA.
 * Aceita apenas UID e 5 combinações fixas de tabela/coluna do schema.sql.
 * NÃO conectado a endpoints públicos ou contas de serviço de produção.
 */
import {validUid} from './plan.js';
const SIMPLE=Object.freeze({
  avatar_pending:'SELECT uid, public_id FROM avatar_pending WHERE uid = ? LIMIT 2',
  avatar_rate:'SELECT uid, next_at FROM avatar_rate WHERE uid = ? LIMIT 2',
  avatar_mutex:'SELECT uid, expires_at FROM avatar_mutex WHERE uid = ? LIMIT 2'
});
const MODERATION=Object.freeze({
  actor_uid:'SELECT id, actor_uid, target_uid FROM avatar_moderation WHERE actor_uid = ? AND id > ? ORDER BY id ASC LIMIT ?',
  target_uid:'SELECT id, actor_uid, target_uid FROM avatar_moderation WHERE target_uid = ? AND id > ? ORDER BY id ASC LIMIT ?'
});

export function createAvatarD1ReadAdapter(db,uid) {
  if(!validUid(uid)) throw Error('invalid_uid');
  if(typeof db?.prepare!=='function') throw Error('invalid_d1_binding');
  return Object.freeze({
    async readPage(table,role,requestUid,cursor=null,limit=100) {
      if(requestUid!==uid || !Number.isInteger(limit) ||
        limit<1 || limit>100) throw Error('disallowed_d1_request');
      let statement;
      if(Object.hasOwn(SIMPLE,table) && role==='uid') {
        if(cursor!==null) throw Error('disallowed_d1_cursor');
        statement=db.prepare(SIMPLE[table]).bind(uid);
      } else if(table==='avatar_moderation' && Object.hasOwn(MODERATION,role)){
        if(cursor!==null && (!/^[1-9]\d{0,14}$/.test(cursor) ||
          !Number.isSafeInteger(Number(cursor)))) throw Error('disallowed_d1_cursor');
        const start=cursor===null?0:Number(cursor);
        statement=db.prepare(MODERATION[role]).bind(uid,start,limit);
      } else throw Error('disallowed_d1_request');
      const result=await statement.all();
      if(!result || !Array.isArray(result.results)) throw Error('invalid_d1_response');
      if(result.results.length>(table==='avatar_moderation'?limit:1))
        throw Error('invalid_d1_response');
      const rows=result.results.map(row=>({...row}));
      return {
        items:rows,
        nextCursor:table==='avatar_moderation' && rows.length===limit
          ? String(rows.at(-1)?.id??'') : null
      };
    }
  });
}
