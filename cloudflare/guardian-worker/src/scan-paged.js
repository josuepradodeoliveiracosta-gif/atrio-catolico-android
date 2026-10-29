// Bounded, resumable server-only scans; never used in the read-only QA path.
// A failed page is retried rather than advancing past a failed moderation event.
const GROUPS=['posts','replies','reports'];
const BATCH_PAGES=2;
const MAX={posts:30,replies:30,reports:15};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v);
const str=v=>({stringValue:v});
const value=(d,k)=>d?.fields?.[k]?.stringValue||'';
function checkpoint(doc,now){
  if(!doc)return {
    since:new Date(Date.parse(now)-20*60000).toISOString(),until:now,after:null
  };
  const mode=value(doc,'mode'),start=value(doc,'windowStart'),end=value(doc,'windowEnd');
  if(!iso(start)||!iso(end)||Date.parse(start)>Date.parse(end)||Date.parse(end)>Date.parse(now)+60000)
    throw Error('invalid_scan_checkpoint');
  if(mode==='complete'){
    const since=new Date(Math.max(0,Date.parse(end)-1000)).toISOString();
    if(Date.parse(since)>Date.parse(now))throw Error('invalid_scan_checkpoint');
    return {since,until:now,after:null};
  }
  if(mode!=='running')throw Error('invalid_scan_checkpoint');
  const name=value(doc,'cursorName'),time=value(doc,'cursorTime');
  if((name&&!iso(time))||(!name&&time)||time&&
     (Date.parse(time)<Date.parse(start)||Date.parse(time)>Date.parse(end)))
    throw Error('invalid_scan_checkpoint');
  return {since:start,until:end,after:name?{name,time}:null};
}
function stateFields(window,cursor,mode){
  return {mode:str(mode),windowStart:str(window.since),windowEnd:str(window.until),
    cursorName:str(cursor?.name||''),cursorTime:str(cursor?.time||'')};
}
export async function scanPagedCycle(db,settings,{onDocument,onReport},now=new Date().toISOString()){
 if(!settings?.enabled)return {status:'disabled'};
 if(typeof db?.scanPage!=='function'||typeof db?.get!=='function'||
   typeof db?.create!=='function'||typeof db?.update!=='function'||
   typeof onDocument!=='function'||typeof onReport!=='function'||!iso(now))
   throw Error('paged_scanner_not_configured');
 const counters={clear:0,review:0,warn:0,hold:0,invalid:0,
   duplicate_or_changed:0,ignored:0,missing:0,error:0,
   pages:0,backlogGroups:0,pausedGroups:0};
 for(const group of GROUPS){
   const path='guardian_runtime/scan_'+group;
   try{
     let current=await db.get(path);
     const window=checkpoint(current,now);
     const wasRunning=value(current,'mode')==='running';
     // Register the processing window BEFORE first read, so a crash retries it.
     if(!wasRunning) {
       const fields=stateFields(window,null,'running');
       if(current)await db.update(path,fields,current.updateTime);
       else await db.create(path,fields);
       current=await db.get(path);
       if(!current?.updateTime)throw Error('checkpoint_write_missing');
     }
     let after=window.after;
     let lastHadMore=false,failed=false;
     for(let page=0;page<BATCH_PAGES;page++){
       const result=await db.scanPage(group,{...window,after,max:MAX[group]});
       if(!Array.isArray(result?.documents)||result.documents.length>MAX[group])
         throw Error('invalid_page');
       // A query that claims more pages must provide a cursor that advances.
       if(result.nextCursor&&(
         !result.documents.length||
         result.nextCursor.name===after?.name))
         throw Error('invalid_next_cursor');
       counters.pages++;
       for(const doc of result.documents){
         try{
           const action=group==='reports'?
             await onReport(db,doc,settings):
             await onDocument(db,doc,settings);
           if(action in counters)counters[action]++;
         }catch{counters.error++;failed=true;break;}
       }
       if(failed)break;
       lastHadMore=!!result.nextCursor;
       const newState=stateFields(window,result.nextCursor,
         lastHadMore?'running':'complete');
       await db.update(path,newState,current.updateTime);
       if(!lastHadMore)break;
       after=result.nextCursor;
       current=await db.get(path);
       if(!current?.updateTime)throw Error('checkpoint_read_missing');
     }
     if(failed)counters.pausedGroups++;
     else if(lastHadMore)counters.backlogGroups++;
   }catch{
     counters.error++;
     counters.pausedGroups++;
   }
 }
 return counters;
}
