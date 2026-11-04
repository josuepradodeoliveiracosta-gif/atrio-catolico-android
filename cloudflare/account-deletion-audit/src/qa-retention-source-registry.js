/**
 * REVIEW-ONLY account data/retention registry. Source-code coverage is not
 * evidence that a live service contains no other tables or personal data.
 * Never executes deletion, contacts Firebase/Cloudflare or approves release.
 */
import {RULES_SCHEMA_CONTRACT,EXPLICIT_UNRESOLVED_SCOPES}
  from './qa-firestore-schema-contract.js';
import {EXTERNAL_SCOPES} from './deletion-orchestrator.js';

export const D1_REVIEW_TABLES=Object.freeze([
  Object.freeze({service:'avatar',table:'avatar_rate',
    identityRisk:'uid_and_rate_timestamp',review:'account_operational'}),
  Object.freeze({service:'avatar',table:'avatar_pending',
    identityRisk:'uid_and_cloudinary_public_id',review:'account_media'}),
  Object.freeze({service:'avatar',table:'avatar_moderation',
    identityRisk:'actor_and_target_uid_with_reason',review:'third_party_moderation'}),
  Object.freeze({service:'avatar',table:'avatar_mutex',
    identityRisk:'uid_and_lock_nonce',review:'account_operational'}),
  Object.freeze({service:'push',table:'delivered',
    identityRisk:'event_key_may_encode_identity',review:'notification_event_identity'}),
  Object.freeze({service:'push',table:'push_delivery_stats',
    identityRisk:'aggregate_claim_requires_proof',review:'aggregate_verification'}),
  Object.freeze({service:'push',table:'guardiao_ai_budget',
    identityRisk:'event_key_may_encode_identity',review:'notification_event_identity'})
]);

// Exact reviewed D1 definitions, including types, nullability and composite
// constraints. A new column in an existing table can carry a UID or token;
// checking table names alone is NOT sufficient for privacy retention.
const D1_REVIEW_DEFINITIONS=Object.freeze({
  avatar:Object.freeze({
    avatar_rate:['uid text primary key not null','next_at integer not null'],
    avatar_pending:['uid text primary key not null','public_id text not null unique',
      'created_at integer not null'],
    avatar_moderation:['id integer primary key autoincrement','actor_uid text not null',
      'target_uid text not null','reason text not null','created_at integer not null'],
    avatar_mutex:['uid text primary key not null','nonce text not null',
      'expires_at integer not null']
  }),
  push:Object.freeze({
    delivered:['event_key text primary key not null','created_at integer not null'],
    push_delivery_stats:[
      'hour_bucket integer not null','kind text not null','outcome text not null',
      'fcm_http_status integer not null default 0','events integer not null default 1',
      'attempted integer not null default 0','accepted integer not null default 0',
      'primary key(hour_bucket,kind,outcome,fcm_http_status)'
    ],
    guardiao_ai_budget:['event_key text primary key not null','day_bucket integer not null']
  })
});

const NON_DATA_RULE_PATHS=new Set([
  '/databases/{database}/documents','/{document=**}'
]);
const PENDING='legal_and_operational_review_required';
const reviewItem=(id,source,review,classification)=>
  Object.freeze({id,source,review,classification,
    retentionState:PENDING,retentionPeriodDays:null,
    lawfulBasisReviewed:false,thirdPartyRightsReviewed:false,
    automaticDeletionAuthorized:false,productionEvidenceUrl:null});

/** Source inventory, not evidence of collection/sharing or legal conclusions. */
export function retentionReviewRegistry(){
  const result=[];
  for(const entry of RULES_SCHEMA_CONTRACT){
    if(NON_DATA_RULE_PATHS.has(entry.path))continue;
    result.push(reviewItem('firestore:'+entry.path,'firestore',
      entry.classification,'rules_scope'));
  }
  for(const entry of D1_REVIEW_TABLES)
    result.push(reviewItem('d1:'+entry.service+':'+entry.table,
      'd1',entry.review,entry.identityRisk));
  for(const scope of EXTERNAL_SCOPES)
    result.push(reviewItem('external:'+scope,'external',
      'provider_and_retention_review','external_resource'));
  return Object.freeze(result.sort((a,b)=>a.id.localeCompare(b.id,'en')));
}
export function parsedD1Tables(sql){
  if(typeof sql!=='string'||sql.length>200000)
    throw Error('retention_d1_schema_unreadable');
  const names=[...sql.matchAll(/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s*\(/gim)]
    .map(m=>m[1].toLowerCase());
  if(!names.length||new Set(names).size!==names.length)
    throw Error('retention_d1_schema_unknown_or_duplicate');
  return names.sort();
}
// A deliberately conservative CREATE TABLE parser. Commas inside a composite
// PRIMARY KEY do not split column definitions. Unsupported quotes, malformed
// syntax, ALTER TABLE and incomplete parentheses fail closed. This is a code
// schema contract, NOT a check of the currently deployed D1 schema.
export function parsedD1Definitions(sql){
  if(typeof sql!=='string'||sql.length>200000)
    throw Error('retention_d1_schema_unreadable');
  const source=sql.replace(/^\s*--[^\n]*$/gm,'');
  if(/\bALTER\s+TABLE\b/i.test(source))
    throw Error('retention_d1_schema_drift_review_required');
  const result={};
  const matcher=/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  let match;
  const normalized=s=>s.trim().toLowerCase().replace(/\s+/g,' ')
    .replace(/\s*\(\s*/g,'(').replace(/\s*\)\s*/g,')')
    .replace(/\s*,\s*/g,',');
  while((match=matcher.exec(source))!==null){
    const table=match[1].toLowerCase();
    if(Object.hasOwn(result,table))
      throw Error('retention_d1_schema_unknown_or_duplicate');
    const definitions=[];
    let start=matcher.lastIndex,depth=1,index=start;
    for(;index<source.length;index++){
      const ch=source[index];
      if(ch==="'"
        ||ch==='"'
        ||ch==='\x60')
        throw Error('retention_d1_schema_unreviewed_syntax');
      if(ch==='(')depth++;
      else if(ch===')'){
        depth--;
        if(depth===0){
          definitions.push(normalized(source.slice(start,index)));
          break;
        }
        if(depth<0)throw Error('retention_d1_schema_unbalanced');
      }else if(ch===','&&depth===1){
        definitions.push(normalized(source.slice(start,index)));
        start=index+1;
      }
    }
    if(depth!==0||!definitions.length||definitions.some(x=>!x)||
       !/^\s*;/.test(source.slice(index+1)))
      throw Error('retention_d1_schema_unbalanced');
    result[table]=definitions;
    matcher.lastIndex=index+2;
  }
  const names=parsedD1Tables(sql);
  if(names.length!==Object.keys(result).length)
    throw Error('retention_d1_schema_unreviewed_syntax');
  return result;
}
export function requireD1ReviewCoverage(service,sql){
  if(service!=='avatar'&&service!=='push')
    throw Error('retention_d1_service_unreviewed');
  const actual=parsedD1Tables(sql);
  const registered=D1_REVIEW_TABLES.filter(x=>x.service===service)
    .map(x=>x.table).sort();
  if(actual.length!==registered.length||
     actual.some((name,i)=>name!==registered[i]))
    throw Error('retention_d1_schema_drift_review_required');
  const definitions=parsedD1Definitions(sql);
  const expected=D1_REVIEW_DEFINITIONS[service];
  if(Object.keys(definitions).length!==Object.keys(expected).length ||
     actual.some(name=>!Array.isArray(expected[name]) ||
       definitions[name].length!==expected[name].length ||
       definitions[name].some((entry,i)=>entry!==expected[name][i])))
    throw Error('retention_d1_column_or_constraint_drift_review_required');
  return Object.freeze({service,reviewedSchemaNames:actual,
    reviewedColumns:Object.values(expected).reduce((n,definitions)=>n+
      definitions.filter(x=>!x.startsWith('primary key(')).length,0),
    legalRetentionApproved:false,productionInventoryVerified:false});
}
export function retentionReadiness(){
  const rows=retentionReviewRegistry();
  if(new Set(rows.map(x=>x.id)).size!==rows.length)
    throw Error('retention_duplicate_source');
  return Object.freeze({
    sourceScopes:rows.length,
    firestoreScopes:rows.filter(x=>x.source==='firestore').length,
    d1Tables:rows.filter(x=>x.source==='d1').length,
    externalSources:rows.filter(x=>x.source==='external').length,
    decisionsApproved:0,
    unresolvedRuleGaps:EXPLICIT_UNRESOLVED_SCOPES.length,
    productionInventoryVerified:false,
    legalRetentionApproved:false,
    accountDeletionAuthorized:false,
    playReleaseAuthorized:false
  });
}
