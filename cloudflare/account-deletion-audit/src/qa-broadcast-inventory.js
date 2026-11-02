/**
 * Isolated broadcast QA: two fixed synthetic identities, no Firebase/FCM IO.
 *
 * A trusted fixture page source advertises one immutable revision and an
 * authoritative row count. This is NOT a real Firestore snapshot; production
 * inventory would require snapshot consistency, complete pagination, IAM,
 * subscription semantics and bounded batches over arbitrary customer UIDs.
 */
import {stageFixtureUid} from '../../privacy-freeze-stage/src/protocol.js';

const REVISION=/^qa-revision-[a-z0-9-]{1,32}$/;
const CURSOR=/^qa-cursor-[a-z0-9-]{1,32}$/;
const FAKE_TOKEN=/^qa-fcm-[a-z0-9-]{1,40}$/;
const REQUEST=/^qa-broadcast-[a-z0-9-]{1,40}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_FIXTURE_ROWS=2;

function exactKeys(value,keys) {
  return value!==null && typeof value==='object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function invalid(){throw Error('qa_broadcast_inventory_unverified');}

/**
 * Fetch every synthetic page *before* allocating a permit or performing effects.
 * Reject mixed revisions, missing rows, repeated UIDs, bad tokens, cursor loops,
 * nonterminal gaps, out-of-order pages and count mismatches. Never infer that
 * an absent nextCursor alone proves a complete user inventory.
 */
export async function collectQaBroadcastInventory({actorUid,readPage}={}) {
  if(!stageFixtureUid(actorUid)||typeof readPage!=='function')invalid();
  let cursor=null,revision=null,total=null,lastUid='';
  const rows=[],seenUids=new Set(),seenTokens=new Set(),seenCursors=new Set();
  for(let pageIndex=0;pageIndex<MAX_FIXTURE_ROWS;pageIndex++){
    const page=await readPage(cursor);
    if(!exactKeys(page,['revision','pageIndex','expectedTotal','rows',
       'nextCursor','complete'])||
       !REVISION.test(page.revision)||
       page.pageIndex!==pageIndex||
       !Number.isSafeInteger(page.expectedTotal)||
       page.expectedTotal<1||page.expectedTotal>MAX_FIXTURE_ROWS||
       !Array.isArray(page.rows)||page.rows.length!==1||
       typeof page.complete!=='boolean'||
       (page.complete && page.nextCursor!==null)||
       (!page.complete && !CURSOR.test(page.nextCursor)))
      invalid();
    if(revision===null){revision=page.revision;total=page.expectedTotal;}
    if(page.revision!==revision||page.expectedTotal!==total)invalid();
    const row=page.rows[0];
    if(!exactKeys(row,['uid','optedIn','token'])||
       !stageFixtureUid(row.uid)||
       typeof row.optedIn!=='boolean'||
       (row.optedIn ? !FAKE_TOKEN.test(row.token) : row.token!==null)||
       seenUids.has(row.uid)||row.uid<=lastUid||
       (row.optedIn && seenTokens.has(row.token)))invalid();
    rows.push(Object.freeze({...row}));
    seenUids.add(row.uid);
    if(row.optedIn)seenTokens.add(row.token);
    lastUid=row.uid;
    if(rows.length>total)invalid();
    if(page.complete){
      if(rows.length!==total||!seenUids.has(actorUid))invalid();
      return Object.freeze({revision,rows:Object.freeze(rows)});
    }
    if(pageIndex+1>=MAX_FIXTURE_ROWS||
       rows.length>=total||seenCursors.has(page.nextCursor))invalid();
    seenCursors.add(page.nextCursor);
    cursor=page.nextCursor;
  }
  invalid();
}

/**
 * One simulated per-token send, under the existing HMAC stage Service Binding
 * and atomic D1 admission for both sender and recipient. Never uses topics.
 * A fake FCM acknowledgement is NOT confirmation of a real delivery:
 * independent reconciliation must close the D1 ticket.
 * If a send is unknown, keep the ticket open; never retry automatically.
 */
export async function runQaBroadcast({
  actorUid,requestId,readPage,pushClient,sendFixture
}={}) {
  if(!stageFixtureUid(actorUid)||!REQUEST.test(requestId)||
    typeof pushClient?.request!=='function'||typeof sendFixture!=='function')
    throw Error('qa_broadcast_invalid_request');
  const inventory=await collectQaBroadcastInventory({actorUid,readPage});
  const recipients=inventory.rows.filter(x=>x.uid!==actorUid&&x.optedIn);
  if(recipients.length===0)return Object.freeze({
    status:'qa_no_opted_in_recipients',productionReady:false
  });
  // The staging binding currently permits exactly one synthetic recipient.
  if(recipients.length!==1)invalid();
  const permit=await pushClient.request('admit',{
    actorUid,recipientUids:recipients.map(x=>x.uid)
  });
  if(permit?.status!=='stage_admitted'||!UUID.test(permit.operationId))
    throw Error('qa_broadcast_admission_unverified');
  const payload=Object.freeze({
    kind:'qa_broadcast',requestId,recipientUid:recipients[0].uid,
    fakeToken:recipients[0].token
  });
  try{
    // No network implementation is included. Test fixtures record this call.
    const effect=await sendFixture(payload);
    return Object.freeze({
      status:effect?.status==='qa_simulated_accepted'
        ? 'qa_fake_send_pending_reconciliation'
        : 'qa_ambiguous_effect_pending_reconciliation',
      operationId:permit.operationId,productionReady:false
    });
  }catch{
    return Object.freeze({
      status:'qa_ambiguous_effect_pending_reconciliation',
      operationId:permit.operationId,productionReady:false
    });
  }
}

export const QA_BROADCAST_READINESS=Object.freeze({
  productionIntegrated:false,realFcmEnabled:false,
  userDataAllowed:false,stagingOnly:true,
  durableRealInventoryAvailable:false,automaticRetryEnabled:false,
  automaticTicketClosure:false
});
