import {classify,decide,safeNotice,VALID_ID} from './policy.js';
import {Firestore,token,actorId,caseId,pathOf,string,bool,str,timestamp,ROOT} from './firestore.js';
import {qaShadowAllowed,scanQaShadow} from './shadow-qa.js';
import {qaMonitorAllowed,readQaWorkflowStatus} from './github-qa-monitor.js';
import {qaDispatchAllowed,dispatchQaWorkflow,dueForDailyDispatch} from './github-qa-dispatch.js';
import {scanPagedCycle} from './scan-paged.js';
const json=(status,code)=>new Response(JSON.stringify({status:code}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const MASK=/^posts\/[A-Za-z0-9_-]{1,128}(?:\/replies\/[A-Za-z0-9_-]{1,128})?$/;
export function settingsOf(doc,env) {
  const enabled=env.GUARDIAN_V2_TEST_MODE!=='true' && env.GUARDIAN_V2_ENABLED==='true' && bool(doc,'enabled') && !bool(doc,'emergencyStop');
  return {enabled,allowHold:enabled&&env.GUARDIAN_V2_HOLD_ENABLED==='true'&&bool(doc,'allowHold')};
}
function cleanItem(document) {
  const path=pathOf(document);if(!MASK.test(path)||!document.updateTime)return null;
  const parts=path.split('/'),owner=string(document,'uid');
  if(!VALID_ID.test(owner))return null;
  return {path,parts,owner,text:(parts.length===2?string(document,'title')+' ':'')+string(document,'body'),doc:document,kind:parts.length===2?'post':'reply'};
}
function caseFields(item,finding,now,action) {
  return {engine:str('v2'),ownerUid:str(item.owner),targetPath:str(item.path),targetType:str(item.kind),postId:str(item.parts[1]),...(item.kind==='reply'?{replyId:str(item.parts[3])}:{}),ruleCode:str(finding.rule),sourceUpdateTime:str(item.doc.updateTime),reason:str('Possível violação: '+finding.rule),status:str(action==='hold'?'held':action==='warn'?'warned':'review'),source:str('guardiao'),createdAt:timestamp(now)};
}
// Atua por eventos backend com polling agendado limitado. Não depende do app.
export async function processDocument(db,document,settings,now=new Date().toISOString()) {
  if(!settings.enabled)return 'disabled';
  const item=cleanItem(document);if(!item)return 'invalid';
  const root=db.resource||ROOT;
  const finding=classify(item.text,settings.context||{}),policy=decide(finding,settings);
  if(policy==='clear')return 'clear';
  const primaryId=await caseId(item.path);
  // Casos novos são versionados: uma edição posterior pode demandar nova revisão.
  // Casos antigos sem sourceUpdateTime nunca são reabertos automaticamente.
  const previous=await db.get('guardian_cases/'+primaryId);
  const oldVersion=string(previous,'sourceUpdateTime');
  if(previous&&(!oldVersion||oldVersion===item.doc.updateTime))
    return 'duplicate_or_changed';
  const id=previous?await caseId(item.path+'@'+item.doc.updateTime):primaryId;
  // Nunca retirar um post com subcoleções de respostas de maneira automática.
  const hold=policy==='review'&&finding.level==='hold_candidate'&&settings.allowHold&&item.kind==='reply';
  const action=hold?'hold':policy;
  const notice=safeNotice(finding.rule,action);
  const fields=caseFields(item,finding,now,action);
  const writes=[{update:{name:root+'/guardian_cases/'+id,fields},currentDocument:{exists:false}},
    {update:{name:root+'/guardian_audit/'+id,fields:{event:str(action),caseId:str(id),at:timestamp(now),actor:str('guardian_v2')}},currentDocument:{exists:false}},
    {update:{name:root+'/guardian_notices/'+item.owner+'/items/'+id,fields:{title:str(notice.title),body:str(notice.body),caseId:str(id),ruleCode:str(finding.rule),action:str(action),createdAt:timestamp(now)}},currentDocument:{exists:false}}];
  if(!hold){
    // Mesmo um simples aviso/revisão não deve registrar evidência obsoleta.
    // O Firestore verifica atomicamente a revisão do documento original.
    writes.push({verify:root+'/'+item.path,currentDocument:{updateTime:item.doc.updateTime}});
  }
  if(hold){
    // Copy-on-write atômico: somente o conteúdo da revisão exata pode ser retirado.
    writes.push({update:{name:root+'/guardiao_quarantine/'+id,fields:{ownerUid:str(item.owner),targetType:str(item.kind),targetPath:str(root+'/'+item.path),postId:str(item.parts[1]),replyId:str(item.parts[3]),reason:str('Possível violação: '+finding.rule),ruleCode:str(finding.rule),status:str('held'),heldAt:timestamp(now),originalFields:{mapValue:{fields:item.doc.fields}}}},currentDocument:{exists:false}});
    writes.push({delete:root+'/'+item.path,currentDocument:{updateTime:item.doc.updateTime}});
  }
  try{await db.commit(writes);return action;}
  catch(e){if(e.status===409||e.status===412)return 'duplicate_or_changed';throw e;}
}
export async function processReport(db,report,settings) {
  // Denúncias são pistas, não são prova e nunca contabilizam infração confirmada.
  if(!settings.enabled)return 'disabled';
  if(!/^reports\/[A-Za-z0-9_-]{1,128}$/.test(pathOf(report))||
      string(report,'source')==='guardiao')return 'ignored';
  const postId=string(report,'postId'),replyId=string(report,'replyId');
  if(!VALID_ID.test(postId)||(replyId&&!VALID_ID.test(replyId)))return 'invalid';
  const path='posts/'+postId+(replyId?'/replies/'+replyId:'');
  const document=await db.get(path);if(!document)return 'missing';
  return processDocument(db,document,settings);
}
export async function scanOnce(db,settings){
  if(!settings.enabled)return {status:'disabled'};
  if(typeof db.scanPage==='function')return scanPagedCycle(db,settings,{onDocument:processDocument,onReport:processReport});
  // Limites explícitos por execução: nenhum documento ilimitado nem varredura retroativa.
  const counters={clear:0,review:0,warn:0,hold:0,invalid:0,duplicate_or_changed:0,ignored:0,missing:0,error:0};
  for(const group of ['posts','replies']) {
    let docs;try{docs=await db.scan(group,20,30);}catch{counters.error++;continue;}
    for(const doc of docs) {
      try{const result=await processDocument(db,doc,settings);if(result in counters)counters[result]++;}
      catch{counters.error++;}
    }
  }
  try {
    const reports=await db.scan('reports',20,15);
    for(const report of reports){
      try{const state=await processReport(db,report,settings);if(state in counters)counters[state]++;}
      catch{counters.error++;}
    }
  }catch{counters.error++;}
  return counters;
}
async function admin(request,db,env){
  const uid=await actorId(request,env);if(!uid)return null;
  const record=await db.get('admins/'+uid);return bool(record,'enabled')?uid:null;
}
async function body(request) {
  if(Number(request.headers.get('content-length')||'0')>2048)throw Error('oversize');
  const reader=request.body?.getReader();if(!reader)throw Error('empty');
  const parts=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();throw Error('oversize');}parts.push(value);}}
  finally{reader.releaseLock();}
  const b=new Uint8Array(size);let i=0;for(const p of parts){b.set(p,i);i+=p.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
}
// Lógica de revisão extraída para ser testável sem chaves Firebase ou contas reais.
function denial(status,code){const e=Error(code);e.status=status;return e;}
export async function reviewCase(db,uid,input,now=new Date().toISOString()) {
  if(!VALID_ID.test(uid)||!input||!/^guard_[a-f0-9]{32}$/.test(input.caseId||'')||
      !['restore','confirm'].includes(input.action)||typeof input.note!=='string'||
      input.note.trim().length<5||input.note.length>300)throw denial(400,'invalid_review');
  const root=db.resource||ROOT;
  const held=await db.get('guardiao_quarantine/'+input.caseId);
  const c=await db.get('guardian_cases/'+input.caseId);
  if(!held?.updateTime||!c?.updateTime||string(held,'status')!=='held'||
      string(c,'status')!=='held')throw denial(409,'not_pending');
  const owner=string(held,'ownerUid');
  if(uid===owner)throw denial(403,'self_review');
  if(owner!==string(c,'ownerUid')||!VALID_ID.test(owner))throw denial(409,'wrong_owner');
  const target=string(held,'targetPath');
  if(!target.startsWith(root+'/posts/')||!MASK.test(target.slice(root.length+1))||
      target!==root+'/'+string(c,'targetPath'))throw denial(409,'invalid_target');
  const fields=held.fields?.originalFields?.mapValue?.fields;
  if(!fields||fields.uid?.stringValue!==owner)throw denial(409,'evidence_missing');
  const restored=input.action==='restore';
  if(restored) {
    if((await db.get(string(c,'targetPath')))!==null)throw denial(409,'target_exists');
    const postId=string(c,'postId');
    if(!await db.get('posts/'+postId))throw denial(409,'parent_missing');
  }
  const at=timestamp(now);
  const reviewFields={status:str(restored?'restored':'removed'),reviewedBy:str(uid),
    reviewNote:str(input.note.trim()),reviewedAt:at};
  const writes=[];
  if(restored)writes.push({update:{name:target,fields},currentDocument:{exists:false}});
  for(const old of [held,c])writes.push({update:{name:old.name,fields:reviewFields},
      updateMask:{fieldPaths:Object.keys(reviewFields)},currentDocument:{updateTime:old.updateTime}});
  writes.push({update:{name:root+'/guardian_audit/'+input.caseId+'_'+(restored?'restored':'confirmed'),
    fields:{caseId:str(input.caseId),actor:str(uid),event:str(input.action),at}},currentDocument:{exists:false}});
  writes.push({update:{name:root+'/guardian_notices/'+owner+'/items/'+input.caseId+'_review',
    fields:{title:str('Átrio Guardião'),body:str(restored?'Seu conteúdo foi restaurado após revisão.':'A administração concluiu a revisão de sua publicação.'),
      caseId:str(input.caseId),action:str(input.action),createdAt:at}},currentDocument:{exists:false}});
  await db.commit(writes);
  return restored?'restored':'confirmed';
}
export async function handleRequest(request,env) {
  const path=new URL(request.url).pathname;
  if(path==='/health')return json(200,env.GUARDIAN_V2_TEST_MODE==='true'?'guardian_v2_qa_safe':'guardian_v2_isolated');
  if(!['/admin/config','/admin/review'].includes(path)||request.method!=='POST')return json(404,'not_found');
  // QA has no privileged backend operations, even if someone attaches credentials.
  if(env.GUARDIAN_V2_TEST_MODE==='true')return json(503,'qa_read_only');
  try {
    if(!env.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON)return json(503,'not_configured');
    const db=new Firestore(await token(env),env.GUARDIAN_FIREBASE_PROJECT_ID);const uid=await admin(request,db,env);
    if(!uid)return json(403,'forbidden');
    const input=await body(request);
    if(path==='/admin/config') {
      if(!input||Object.keys(input).sort().join(',')!=='allowHold,emergencyStop,enabled'||
        ['enabled','allowHold','emergencyStop'].some(k=>typeof input[k]!=='boolean'))return json(400,'invalid_config');
      const current=await db.get('guardian_config/policy');
      if(!current?.updateTime)return json(409,'config_not_initialized');
      await db.update('guardian_config/policy',{enabled:{booleanValue:input.enabled},allowHold:{booleanValue:input.allowHold},emergencyStop:{booleanValue:input.emergencyStop}},current.updateTime);
      return json(200,'updated');
    }
    if(!input||Object.keys(input).sort().join(',')!=='action,caseId,note'||!/^guard_[a-f0-9]{32}$/.test(input.caseId||'')||!['restore','confirm'].includes(input.action)||typeof input.note!=='string'||input.note.trim().length<5||input.note.length>300)return json(400,'invalid_review');
    const decision=await reviewCase(db,uid,input);
    return json(200,decision);
  }catch(e){return json([400,403,409,412].includes(e.status)?(e.status===412?409:e.status):503,'operation_unavailable');}
}
export default {
  fetch:handleRequest,
  async scheduled(event,env,ctx) {
    // Cron can be installed in QA to verify scheduling without touching Firebase.
    if(env.GUARDIAN_V2_TEST_MODE==='true'){
      // Independent QA cron. No privilege to change content, even in remote QA.
      if(!qaShadowAllowed(env)){
        // The existing 15-minute QA Cron may inspect public GitHub run status
        // at most once an hour. It never accesses Firebase, secrets or user data.
        const when=event?.scheduledTime;
        let activated=false;
        if(qaMonitorAllowed(env)&&Number.isFinite(when)
          && new Date(when).getUTCMinutes()===0) {
          activated=true;
          ctx.waitUntil((async()=>{
            const status=await readQaWorkflowStatus(env);
            console.log('guardian_v2_qa_monitor',JSON.stringify(status));
          })());
        }
        // Separately opt-in once a day. It NEVER calls Firebase or changes
        // QA_REMOTE_READY. Without a specifically scoped PAT it is inert.
        if(qaDispatchAllowed(env)&&dueForDailyDispatch(when)){
          activated=true;
          ctx.waitUntil((async()=>{
            const outcome=await dispatchQaWorkflow(env,when);
            console.log('guardian_v2_qa_dispatch',JSON.stringify(outcome));
          })());
        }
        if(!activated)console.log('guardian_v2_qa_cron_tick');
        return;
      }
      ctx.waitUntil((async()=>{
        try {
          const db=new Firestore(await token(env),env.GUARDIAN_FIREBASE_PROJECT_ID);
          // Only expose scan; no commit/create/update/get reaches this code.
          const result=await scanQaShadow({scan:(...args)=>db.scanQa(...args)},env);
          console.log('guardian_v2_qa_shadow_counts',JSON.stringify(result));
        }catch{console.log('guardian_v2_qa_shadow_unavailable');}
      })());
      return;
    }
    if(env.GUARDIAN_V2_ENABLED!=='true')return;
    ctx.waitUntil((async()=>{try{const db=new Firestore(await token(env),env.GUARDIAN_FIREBASE_PROJECT_ID);const config=await db.get('guardian_config/policy');
      const metrics=await scanOnce(db,settingsOf(config,env));
      if(metrics.status!=='disabled'){
        const current=await db.get('guardian_runtime/last_scan');
        const fields={scannedAt:timestamp(new Date().toISOString()),
          review:{integerValue:String(metrics.review)},warn:{integerValue:String(metrics.warn)},
          error:{integerValue:String(metrics.error)},
          backlogGroups:{integerValue:String(metrics.backlogGroups||0)},
          pausedGroups:{integerValue:String(metrics.pausedGroups||0)}};
        try {
          if(current?.updateTime)await db.update('guardian_runtime/last_scan',fields,current.updateTime);
          else await db.create('guardian_runtime/last_scan',fields);
        }catch{}
      }}catch{ /* Fail closed. Monitor by external metrics. */ }})());
  }
};