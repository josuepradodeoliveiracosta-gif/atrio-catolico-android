/**
 * READ-ONLY QA review of D1 sqlite_master table DEFINITIONS already exported
 * by an authorized operator. Neither connects to Cloudflare nor receives
 * data rows. An unsigned JSON file is NOT verified production evidence.
 *
 * Query (metadata only):
 * SELECT name, sql FROM sqlite_master
 * WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 30
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireD1ReviewCoverage} from './qa-retention-source-registry.js';

const MAX_ROWS=30,MAX_DDL_LENGTH=10000;
const TABLE_NAME=/^[a-z_][a-z0-9_]{0,100}$/;
const CREATE=/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\([\s\S]*\)\s*$/i;
const PLATFORM_TABLE='_cf_KV';
function fail(reason){throw Error('qa_live_d1_review_'+reason);}
function owned(x,key){return Object.prototype.hasOwnProperty.call(x,key);}

/** The only accepted system table is Cloudflare's internal _cf_KV. */
export function compareD1TableMetadata(service,metadata){
  if(!['avatar','push'].includes(service))fail('unknown_service');
  if(!Array.isArray(metadata)||metadata.length<1||metadata.length>MAX_ROWS)
    fail('invalid_table_list');
  const names=new Set(),ddl=[];
  let systemTables=0;
  for(const item of metadata){
    if(!item || Object.getPrototypeOf(item)!==Object.prototype ||
       Object.keys(item).sort().join(',')!=='name,sql' ||
       typeof item.name!=='string'||typeof item.sql!=='string')
      fail('invalid_table_metadata');
    if(names.has(item.name))fail('duplicate_table');
    names.add(item.name);
    if(item.name===PLATFORM_TABLE){
      systemTables++;
      if(item.sql.length<20||item.sql.length>MAX_DDL_LENGTH ||
         !/^CREATE\s+TABLE\s+_cf_KV\s*\(/i.test(item.sql))
        fail('unexpected_platform_table');
      continue;
    }
    if(!TABLE_NAME.test(item.name)||item.sql.length>MAX_DDL_LENGTH ||
       item.sql.includes(';'))fail('untrusted_table_statement');
    const match=item.sql.match(CREATE);
    if(!match||match[1].toLowerCase()!==item.name)
      fail('untrusted_table_statement');
    // sqlite_master omits IF NOT EXISTS and final semicolon. Normalize
    // those syntactic differences, then reuse the exact reviewed SQL
    // column/constraint contract used for source-code drift detection.
    const normalized=item.sql.trim().replace(
      /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
      'CREATE TABLE IF NOT EXISTS '
    );
    ddl.push(normalized+';');
  }
  if(systemTables>1)fail('unexpected_platform_table');
  let reviewed;
  try {reviewed=requireD1ReviewCoverage(service,ddl.join('\n'));}
  catch {fail('column_or_table_drift');}
  return Object.freeze({
    service,reviewedTables:reviewed.reviewedSchemaNames.length,
    reviewedColumns:reviewed.reviewedColumns,
    schemaMatchesReviewedSource:true,
    dataRowsInspected:false,
    cloudflareAccountVerified:false,
    sourceAuthenticityVerified:false,
    reviewerIdentityVerified:false,
    retentionLegallyApproved:false,
    operationalDeletionVerified:false,
    playReleaseAuthorized:false
  });
}

export function compareD1MetadataPair(input){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||
     Object.keys(input).sort().join(',')!=='avatar,push')
    fail('invalid_pair');
  const avatar=compareD1TableMetadata('avatar',input.avatar);
  const push=compareD1TableMetadata('push',input.push);
  return Object.freeze({totalTables:avatar.reviewedTables+push.reviewedTables,
    totalColumns:avatar.reviewedColumns+push.reviewedColumns,
    systems:Object.freeze([avatar,push]),sourceAuthenticityVerified:false,
    retentionLegallyApproved:false,playReleaseAuthorized:false});
}

// Optional Termux offline review of a PRIVATE schema-only JSON file.
// No secrets/tokens/data rows, deployment, logs or destructive operations.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    if(process.argv.length!==4||process.argv[2]!=='--schema-only')
      fail('usage');
    const input=JSON.parse(readFileSync(process.argv[3],'utf8'));
    process.stdout.write(JSON.stringify(compareD1MetadataPair(input),null,2)+'\n');
  }catch{
    // Deliberately do not echo paths, payloads, account IDs or credentials.
    console.error('Inventário D1 não homologado: revise o arquivo de estrutura.');
    process.exitCode=1;
  }
}
