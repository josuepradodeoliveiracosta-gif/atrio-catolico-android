// Offline synthetic fixture bridge, not an authorization or network adapter.
import {buildReportQueue} from './report-queue.mjs';
const fixture=x=>typeof x==='string'&&/^fixture_[A-Za-z0-9_-]{1,64}$/.test(x);
const origins={reports:'FORUM',user_reports:'USERS',feed_reports:'FEED'};
export function dashboardFixture(ctx,rows,now){
 try{
  if(!Array.isArray(rows)||rows.length>100||!rows.every(r=>r&&[r.reportId,r.reporterUid,r.targetId].every(fixture)&&(r.childId===null||fixture(r.childId))))return null;
  const q=buildReportQueue(ctx,rows,now);
  if(!q.ok||q.remoteAuthorized!==false||q.coverage!=='page_only')return null;
  const lines=q.groups.map((g,i)=>[`caso-${String(i+1).padStart(3,'0')}`,origins[g.collection],g.targetType.toUpperCase(),g.urgency.toUpperCase(),g.categories.map(c=>c.toUpperCase()).join(','),g.oldestAtMs,g.reportCount,g.distinctReporters].join('\t'));
  return ['GUARDIAN_FIXTURE_V1',...lines].join('\n')+'\n';
 }catch{return null;}
}
export const NOW=Date.parse('2026-11-28T04:00:00Z');
export const CTX=Object.freeze({environment:'offline-fixture',project:'guardian-v2-qa-fixture',role:'moderator',authenticated:true,active:true,sessionFresh:true});
export function exampleRows(){
 const r={collection:'reports',reportId:'fixture_r1',reporterUid:'fixture_a',targetType:'post',targetId:'fixture_p1',childId:null,status:'pending',createdAtMs:NOW-1000,category:'threat',urgency:'urgent'};
 return [r,{...r,reportId:'fixture_r2',reporterUid:'fixture_b'}, {...r,collection:'user_reports',reportId:'fixture_r3',targetType:'user',targetId:'fixture_user',category:'privacy',urgency:'priority'}, {...r,collection:'feed_reports',reportId:'fixture_r4',targetId:'fixture_feed',category:'spam',urgency:'normal'}, {...r,reportId:'fixture_r5',status:'dismissed'}];
}
