// Laboratory budget guard, not a billing meter or a CPU measurement.
// One instance per invocation. Reserve attempts before I/O, never refund.
// Keep finalization separate so a transport budget failure cannot consume it.
export const FREE_TRANSPORT_LIMITS=Object.freeze({
 claim:Object.freeze({requests:9,reads:24,writes:1,d1:0}),
 worker:Object.freeze({requests:32,reads:76,writes:5,d1:8}),
 finish:Object.freeze({requests:4,reads:1,writes:1,d1:0})
});
export const FREE_PREPARATION_LIMITS=Object.freeze({
 discovery:Object.freeze({requests:2,reads:2,writes:0,d1:0}),
 recovery:Object.freeze({requests:1,reads:1,writes:0,d1:0}),
 publication:Object.freeze({requests:8,reads:24,writes:3,d1:0})
});
const allLimits=Object.freeze({...FREE_PREPARATION_LIMITS,...FREE_TRANSPORT_LIMITS,
 credential:Object.freeze({requests:2,reads:0,writes:0,d1:0})});
const transportStages=new Set(['claim','worker','finish']);
const project='atrio-catolico-qa-general';
const root='/v1/projects/'+project+'/databases/(default)/documents';
const keys=['requests','reads','writes','d1'];
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const stop=()=>{throw Error('qa_free_invocation_budget')};
function classify(url,init){
 const u=new URL(url),method=(init.method??'GET').toUpperCase();
 if(u.username||u.password||u.hash)stop();
 const units={requests:1,reads:0,writes:0,d1:0};
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'&&method==='POST')return units;
 if(u.origin==='https://identitytoolkit.googleapis.com'&&u.pathname==='/v1/projects/'+project+'/accounts:lookup'&&method==='POST')return units;
 if(u.origin==='https://fcm.googleapis.com'&&u.pathname==='/v1/projects/'+project+'/messages:send'&&method==='POST')return units;
 if(u.origin!=='https://firestore.googleapis.com'||!(u.pathname===root||u.pathname.startsWith(root+'/')||u.pathname.startsWith(root+':')))stop();
 const suffix=u.pathname.slice(root.length);
 const data=typeof init.body==='string'?JSON.parse(init.body):init.body;
 if(method==='POST'&&suffix===':batchGet'){
  if(!Array.isArray(data?.documents)||!data.documents.length||data.documents.some(n=>typeof n!=='string'||!n.startsWith(root.slice(4)+'/')))stop();
  units.reads=data.documents.length;
 }else if(method==='POST'&&suffix.endsWith(':runQuery')){
  const limit=data?.structuredQuery?.limit;
  if(!integer(limit)||limit<1||limit>5)stop();
  units.reads=limit;
 }else if(method==='POST'&&suffix===':commit'){
  if(!Array.isArray(data?.writes)||!data.writes.length||data.writes.length>3||data.writes.some(w=>!w?.update?.name?.startsWith(root.slice(4)+'/')))stop();
  units.writes=data.writes.length;
 }else if(method==='POST'&&[':beginTransaction',':rollback'].includes(suffix)){
  // Request only.
 }else if(method==='GET'&&suffix.startsWith('/')){
  const page=u.searchParams.get('pageSize');
  if(u.searchParams.has('pageToken'))stop();
  if(page!==null){if(!/^\d+$/.test(page)||Number(page)<1||Number(page)>6)stop();units.reads=Number(page)}
  else units.reads=1;
 }else if(method==='DELETE'&&suffix.startsWith('/'))units.writes=1;
 else stop();
 return units;
}
export function createFreeInvocationMeter({mode='laboratory'}={}){
 if(!['laboratory','scheduled'].includes(mode))stop();
 let selectedPath=null;
 const used=Object.fromEntries(Object.keys(allLimits).map(s=>[s,Object.fromEntries(keys.map(k=>[k,0]))]));
 function charge(stage,units){
  const cap=allLimits[stage],row=used[stage];
  if(!cap||!units||Object.keys(units).some(k=>!keys.includes(k)))stop();
  for(const k of keys){const n=units[k]??0;if(!integer(n)||row[k]+n>cap[k])stop()}
  // Scheduled mode may publish OR transport, never both. Protect the
  // remaining finalization allowance even when earlier calls fail.
  if(mode==='scheduled'){
   const path=stage==='publication'?'publish':transportStages.has(stage)?'transport':null;
   if(path&&selectedPath&&selectedPath!==path)stop();
   const total=Object.values(used).reduce((n,v)=>n+v.requests,0)+(units.requests??0);
   const reserved=stage==='finish'||selectedPath==='publish'||path==='publish'?0:
     FREE_TRANSPORT_LIMITS.finish.requests-used.finish.requests;
   if(total+reserved>50)stop();
   if(path)selectedPath=path;
  }
  for(const k of keys)row[k]+=units[k]??0;
 }
 return Object.freeze({
  charge,
  beforeHttp(stage,url,init={}){
   if(stage==='credential'){
    const u=new URL(url);
    if(u.origin!=='https://oauth2.googleapis.com'||u.pathname!=='/token'||(init.method??'GET').toUpperCase()!=='POST')stop();
   }
   charge(stage,classify(url,init));
  },
  snapshot:()=>Object.fromEntries(Object.entries(used).map(([s,v])=>[s,{...v}]))
 });
}
// Conservative daily allocation including recovery, claim and finish. Counts
// document attempts, not billable index entries or shared app traffic.
export const FREE_DAILY_ENVELOPE=Object.freeze({
 discovery:1440,recovery:1440,publication:100,transport:100,
 reads:1440*2+1440+100*24+100*(24+76+1),
 writes:100*3+100*(1+5+1),
 requests:1440*2+1440+100*8+100*(9+32+4)
});
