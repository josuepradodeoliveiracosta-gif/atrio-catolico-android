// Átrio Guardião: classificação explicável OFFLINE. Sem I/O ou punição.
import {detectPreventiveSignals, MAX_EVENTS, WINDOW_MS} from './preventive-signals.mjs';
export const RISK_VERSION='guardian-risk-offline-1';
const fixture = v=>typeof v==='string' && /^fixture_[A-Za-z0-9_-]{1,64}$/.test(v);
const exact=(v,keys)=>v!==null && typeof v==='object' && [Object.prototype,null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const key=x=>JSON.stringify([x.actor,x.source,x.space]);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
// Tuplas do classificador atual. Uma etiqueta de revisão não é uma condenação.
const baseline=Object.freeze({none:['clear','none',0],input_limit:['review','low',2],personal_data:['review','high',2],possible_phishing:['hold_candidate','high',3],possible_threat:['review','high',3],links_excessive:['warning','medium',1],recurrence:['review','medium',2],repeated_content:['warning','medium',1]});
const names=['normal','attention','suspected','serious','critical'];
const routing=['no_signal_in_fixture','human_review_standard','human_review_standard','human_review_priority'];
const deny=reason=>({ok:false,reason,version:RISK_VERSION,coverage:'none',remoteAuthorized:false,results:[]});
// findings são resultados sintéticos do classificador existente, fornecidos pelo
// harness, nunca valores de cliente. A entrada de eventos tem o mesmo contrato do marco 07.
// Nível 4 reservado a protocolo humano independente, não implementado neste candidato.
export function classifyRisk(ctx,events,history,findings,now){
 try{
  const prevention=detectPreventiveSignals(ctx,events,history,now);
  if(!prevention.ok)return deny('preventive_input_denied');
  if(!Array.isArray(findings)||findings.length>MAX_EVENTS)return deny('finding_limit');
  const groups=new Map(),seen=new Map();
  function group(x){const k=key(x);if(!groups.has(k))groups.set(k,{actor:x.actor,source:x.source,space:x.space,level:0,reasons:new Set()});return groups.get(k);}
  for(const f of findings){
   if(!exact(f,['findingId','actor','source','space','atMs','rule','level','confidence'])||![f.findingId,f.actor,f.space].every(fixture)||!['forum','feed'].includes(f.source)||!Number.isSafeInteger(f.atMs)||f.atMs<=now-WINDOW_MS||f.atMs>now||typeof f.rule!=='string'||!Object.hasOwn(baseline,f.rule))return deny('invalid_finding');
   const [level,confidence,risk]=baseline[f.rule];
   if(f.level!==level||f.confidence!==confidence)return deny('invalid_finding_tuple');
   const id=JSON.stringify([f.source,f.findingId]),fp=JSON.stringify([f.actor,f.space,f.atMs,f.rule,f.level,f.confidence]);
   if(seen.has(id)){if(seen.get(id)!==fp)return deny('conflicting_finding');continue;}
   seen.set(id,fp);
   const g=group(f);g.level=Math.max(g.level,risk);if(risk)g.reasons.add(f.rule);
  }
  for(const s of prevention.signals){
   const g=group(s);
   // Correlação aumenta a prioridade de triagem, mas nunca chega a nível grave sozinha.
   const combined=s.rules.includes('possible_recurrence')||(s.rules.includes('possible_flood')&&s.rules.includes('possible_repeated_content'));
   g.level=Math.max(g.level,combined?2:1);for(const r of s.rules)g.reasons.add(r);
  }
  const results=[...groups.values()].map(({reasons,...g})=>({...g,label:names[g.level],reasonCodes:[...reasons].sort(cmp),route:routing[g.level],punishmentAuthorized:false}));
  results.sort((a,b)=>b.level-a.level||cmp(key(a),key(b)));
  return {ok:true,version:RISK_VERSION,coverage:'provided_fixture_window_only',remoteAuthorized:false,results};
 }catch{return deny('invalid_input');}
}
