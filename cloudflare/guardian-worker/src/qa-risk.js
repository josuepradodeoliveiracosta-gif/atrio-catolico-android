// QA shadow projection only: no I/O, no persistence, no IDs or text in output.
// The existing shadow reader supplies the same bounded page. No extra queries.
import {classify} from './policy.js';
const id=/^[A-Za-z0-9_-]{1,128}$/;
const ranks=Object.freeze({none:0,links_excessive:1,repeated_content:1,input_limit:2,personal_data:2,recurrence:2,possible_threat:3,possible_phishing:3});
const unavailable=()=>({status:'unavailable',remoteAuthorized:false,punishmentAuthorized:false});
const protectedContext=/\b(oracao|rezar|reza|ave maria|pai nosso|terco|evangelho|biblia|catecismo|citacao|citando|relato|denuncio|ameacou|ameaca recebida)\b/;
const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
const stamp=s=>{if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(s))return NaN;const t=Date.parse(s);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===s.slice(0,19)?t:NaN;};
export function summarizeQaRisk(rows,prefix,now){
 try{
  if(typeof prefix!=='string'||!/^projects\/atrio-catolico-qa(?:-[a-z0-9-]+)?\/databases\/\(default\)\/documents\/$/.test(prefix)||!Number.isSafeInteger(now)||now<300000||!Array.isArray(rows)||rows.length>30)return unavailable();
  const seen=new Map(),groups=new Map();
  for(const {group,doc} of rows){
   if(!['posts','replies'].includes(group)||typeof doc?.name!=='string'||!doc.name.startsWith(prefix)||doc.fields?.qaFixture?.booleanValue!==true)return unavailable();
   const path=doc.name.slice(prefix.length),parts=path.split('/'),f=doc.fields;
   if(parts[0]!=='posts'||!id.test(parts[1]||'')||(group==='posts'?parts.length!==2:parts.length!==4||parts[2]!=='replies'||!id.test(parts[3]||'')))return unavailable();
   const uid=f.uid?.stringValue,body=f.body?.stringValue,title=group==='posts'?(f.title?.stringValue??''):'';
   const at=stamp(f.createdAt?.timestampValue),context=f.qaContext?.stringValue??'unknown';
   if(typeof uid!=='string'||!id.test(uid)||typeof body!=='string'||typeof title!=='string'||title.length+body.length>3999||!Number.isFinite(at)||at>now||at<now-1200000||!['ordinary','prayer','quotation','report','unknown'].includes(context))return unavailable();
   const text=title+' '+body;if(!text.trim())return unavailable();
   const fingerprint=JSON.stringify([uid,at,context,text]);
   if(seen.has(path)){if(seen.get(path)!==fingerprint)return unavailable();continue;}seen.set(path,fingerprint);
   const key=JSON.stringify([uid,parts[1]]);if(!groups.has(key))groups.set(key,{level:0,events:0,tags:new Map()});
   const g=groups.get(key),finding=classify(text),level=ranks[finding.rule];
   if(!Object.hasOwn(ranks,finding.rule))return unavailable();g.level=Math.max(g.level,level);
   // Unknown context never contributes to behavioral counters. No history is inferred.
   if(at>now-300000&&context==='ordinary'&&!protectedContext.test(fold(text))){const tag=fold(text);g.events++;g.tags.set(tag,(g.tags.get(tag)||0)+1);}
  }
  const levels=[0,0,0,0];let flood=0,repetition=0;
  for(const g of groups.values()){const b=g.events>=8,r=Math.max(0,...g.tags.values())>=4;if(b)flood++;if(r)repetition++;g.level=Math.max(g.level,b&&r?2:b||r?1:0);levels[g.level]++;}
  return {status:'observed',coverage:'loaded_qa_page_only',levels,flood,repetition,remoteAuthorized:false,punishmentAuthorized:false};
 }catch{return unavailable();}
}
