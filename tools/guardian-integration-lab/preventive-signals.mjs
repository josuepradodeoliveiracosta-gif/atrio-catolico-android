// Candidato OFFLINE inspirado em Osprey. Sem importação de código externo.
// Somente fixtures públicas autorizadas; não recebe texto, mensagens ou IDs reais.
// Um sinal é hipótese para triagem humana, não decisão nem autorização de escrita.
export const SIGNAL_VERSION = 'guardian-preventive-offline-1';
export const MAX_EVENTS = 500;
export const WINDOW_MS = 300_000;
export const THRESHOLDS = Object.freeze({burst:8,repeat:4,confirmed:3});
const FIX = /^fixture_[A-Za-z0-9_-]{1,64}$/;
const isFixture = v => typeof v === 'string' && FIX.test(v);
const exact = (v,keys) => v !== null && typeof v === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const sources = ['forum','feed'];
const kinds = {forum:['post','reply'],feed:['post','comment']};
const eventKeys = ['eventId','actor','source','space','kind','atMs','contentTag','context'];
const contextKeys = ['environment','project','role','authenticated','active','sessionFresh','scopeApproved','emergencyStop'];
const historyKeys = ['actor','source','space','confirmedCount','verifiedAtMs'];
const integer = v=>Number.isSafeInteger(v)&&v>=0;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const deny=reason=>({ok:false,reason,version:SIGNAL_VERSION,coverage:'none',remoteAuthorized:false,signals:[]});
const groupKey=x=>JSON.stringify([x.actor,x.source,x.space]);
// Conteúdo/tag: igualdade fornecida pela fixture, jamais hash de texto real.
// Contexto protegido é conservador: oração, citação, relato e desconhecido
// não alimentam contadores. O adaptador futuro deve derivá-lo, não confiar no cliente.
export function detectPreventiveSignals(ctx,events,history,now){
 try {
  if(!exact(ctx,contextKeys)||ctx.environment!=='offline-fixture'||ctx.project!=='guardian-v2-qa-fixture'||ctx.role!=='triage'||ctx.authenticated!==true||ctx.active!==true||ctx.sessionFresh!==true||ctx.scopeApproved!==true||ctx.emergencyStop!==false)return deny('scope_denied');
  if(!integer(now)||now<WINDOW_MS||!Array.isArray(events)||events.length>MAX_EVENTS||!Array.isArray(history)||history.length>MAX_EVENTS)return deny('input_limit');
  const hist=new Map();
  for(const h of history){
   if(!exact(h,historyKeys)||![h.actor,h.space].every(isFixture)||!sources.includes(h.source)||!integer(h.confirmedCount)||h.confirmedCount>1000||!integer(h.verifiedAtMs)||h.verifiedAtMs>now||now-h.verifiedAtMs>WINDOW_MS)return deny('invalid_history');
   const key=groupKey(h);if(hist.has(key))return deny('conflicting_history');hist.set(key,h.confirmedCount);
  }
  const seen=new Map(), groups=new Map();
  for(const e of events){
   if(!exact(e,eventKeys)||![e.eventId,e.actor,e.space,e.contentTag].every(isFixture)||!sources.includes(e.source)||!kinds[e.source].includes(e.kind)||!integer(e.atMs)||e.atMs>now||!['ordinary','prayer','quotation','report','unknown'].includes(e.context))return deny('invalid_event');
   const key=JSON.stringify([e.source,e.eventId]),fingerprint=JSON.stringify(eventKeys.map(k=>e[k]));
   if(seen.has(key)){if(seen.get(key)!==fingerprint)return deny('conflicting_event');continue;}seen.set(key,fingerprint);
   if(e.atMs<=now-WINDOW_MS||e.context!=='ordinary')continue;
   const gkey=groupKey(e);if(!groups.has(gkey))groups.set(gkey,{actor:e.actor,source:e.source,space:e.space,events:[],tags:new Map()});
   const g=groups.get(gkey);g.events.push(e);g.tags.set(e.contentTag,(g.tags.get(e.contentTag)||0)+1);
  }
  const signals=[];
  for(const [key,g] of groups){
   const repeated=Math.max(0,...g.tags.values());
   const rules=[];
   if(g.events.length>=THRESHOLDS.burst)rules.push('possible_flood');
   if(repeated>=THRESHOLDS.repeat)rules.push('possible_repeated_content');
   if(rules.length&&(hist.get(key)||0)>=THRESHOLDS.confirmed)rules.push('possible_recurrence');
   if(rules.length)signals.push({actor:g.actor,source:g.source,space:g.space,rules,eligibleEventCount:g.events.length,maxRepeatedCount:repeated,disposition:'human_review_only'});
  }
  signals.sort((a,b)=>cmp(groupKey(a),groupKey(b)));
  return {ok:true,version:SIGNAL_VERSION,coverage:'provided_fixture_window_only',remoteAuthorized:false,signals};
 }catch{return deny('invalid_input');}
}
