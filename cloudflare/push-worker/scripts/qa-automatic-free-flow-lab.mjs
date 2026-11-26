// Private laboratory orchestration. No HTTP input, scheduler, default transport,
// credentials or production binding. The transport is a separate stage to avoid
// assuming that discovery+publication+delivery fit one Free invocation.
const projectId='atrio-catolico-qa-general';
const validKey=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const ignored=reason=>({status:'ignored',reason});
export function createFreeFlowLab({enabled=false,activatedAt,discover,publish,reserveTransport,dispatch}={}){
 if([discover,publish,reserveTransport,dispatch].some(x=>typeof x!=='function'))throw Error('missing_lab_dependency');
 const open=enabled===true&&Number.isSafeInteger(activatedAt)&&activatedAt>0;
 return Object.freeze({
  async discoverAndPublish(){
   if(!open)return ignored('automation_disabled');
   try{
    const candidate=await discover({enabled:true,projectId,activatedAt});
    if(candidate?.status!=='candidate')return candidate;
    return await publish({enabled:true,candidate});
   }catch{return ignored('publication_unavailable')}
  },
  async transport(publication){
   if(!open)return ignored('automation_disabled');
   if(publication?.status!=='published_lab'||!validKey(publication.eventKey))
    return ignored('publication_not_confirmed');
   try{if(await reserveTransport()!==true)return ignored('transport_budget_unavailable')}
   catch{return ignored('transport_budget_unavailable')}
   // Dispatcher owns exclusive claim, revalidation and terminal outcome.
   // No retry from this orchestration, including ambiguous exceptions.
   try{return await dispatch(publication.eventKey)}
   catch{return {status:'transport_unknown_lab'}}
  }
 });
}
