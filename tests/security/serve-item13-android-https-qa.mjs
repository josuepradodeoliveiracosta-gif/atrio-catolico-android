// Harness exclusivamente efêmero. Os handlers reais não são modificados.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue,Timestamp} from 'firebase-admin/firestore';
import {createScopedModerationService,createScopedModerationHttpHandler}
  from '../../firebase/qa-general/chat-moderation-item13.mjs';
import {createCaseReviewWorkflow,createCaseReviewWorkflowHttpHandler}
  from '../../firebase/qa-general/chat-moderation-item13-workflow.mjs';

const projectId='demo-atrio-v11', host='127.0.0.1', port=8095;
const endpoint='https://'+host+':'+port+'/v1/qa/conversations/moderation/case';
const basePath='/v1/qa/conversations/moderation/case';
const uid={clara:'qa-item13-clara',miguel:'qa-item13-miguel',lucia:'qa-item13-lucia'};
const channels=['direct','group'];
const password='SomenteEmuladorItem13-2026!';
const note='Justificativa sintetica de homologacao.';
const reason='Solicito revisao independente em QA.';
const history='HISTORICO-PRIVADO-NAO-RETORNAR';
const [mode,keyPath,certPath]=process.argv.slice(2);
assert.ok(['seed','serve','reject','verify'].includes(mode));
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,host+':9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host+':8089');
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,projectId);
assert.equal(process.env.ATRIO_ITEM13_HTTPS_QA,'1');
assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
assert.ok(!process.env.ATRIO_PUSH_WORKER_URL);
const app=initializeApp({projectId},'item13-https-qa');
const auth=getAuth(app),db=getFirestore(app);
const target=channel=>'qa-item13-'+channel;
const id=(channel,message='m01')=>uid.clara+'__'+target(channel)+'__'+message;
const report=(c,m='m01')=>db.doc((c==='direct'?'chat_reports':'chat_group_reports')+'/'+id(c,m));
const grant=c=>db.doc('chatModerationAssignments/'+c+'/cases/'+id(c));
const state=c=>db.doc('chatModerationCaseStates/'+c+'/cases/'+id(c));
const neighbour=c=>db.doc((c==='direct'?'chats':'chat_groups')+'/'+target(c)+'/messages/private-neighbour');
const reportData=(c,m='m01')=>({
  [c==='direct'?'chatId':'groupId']:target(c),
  messageId:m,reporterUid:uid.clara,reason:'Relato sintetico de homologacao',
  reportedText:m==='m01'?'Prova sintetica autorizada '+c:history,
  createdAt:Timestamp.fromMillis(1760000000000)
});
function equalKeys(obj,keys){assert.deepEqual(Object.keys(obj).sort(),keys.sort());}
async function seed(){
  for(const account of Object.values(uid)){
    await auth.createUser({uid:account,email:account+'@qa.invalid',password,emailVerified:true});
  }
  const batch=db.batch();
  for(const who of [uid.miguel,uid.lucia])batch.set(db.doc('admins/'+who),{enabled:true});
  for(const c of channels){
    batch.set(report(c),reportData(c));
    batch.set(report(c,'m02'),reportData(c,'m02'));
    batch.set(neighbour(c),{text:history});
    batch.set(grant(c),{moderatorUid:uid.miguel,status:'active',
      reviewExpiresAt:Timestamp.fromMillis(Date.now()+3600000)});
  }
  await batch.commit();
  console.log('seed PASS three_auth_accounts two_channels synthetic_only');
}
async function verify(){
  for(const c of channels){
    const s=(await state(c).get()).data(),g=(await grant(c).get()).data();
    assert.equal(s.stage,'appeal_reviewed');
    assert.equal(s.triagedBy,uid.miguel);
    assert.equal(s.decisionBy,uid.miguel);
    assert.equal(s.decision,'action_recommended');
    assert.equal(s.decisionNote,note);
    assert.equal(s.appealBy,uid.clara);
    assert.equal(s.appealReason,reason);
    assert.equal(s.appealReviewedBy,uid.lucia);
    assert.equal(s.appealResult,'revised');
    assert.equal(s.appealReviewNote,note);
    assert.equal(g.moderatorUid,uid.lucia);
    assert.equal(g.status,'revoked');
    assert.deepEqual((await report(c).get()).data(),reportData(c));
    assert.deepEqual((await report(c,'m02').get()).data(),reportData(c,'m02'));
    assert.deepEqual((await neighbour(c).get()).data(),{text:history});
    assert.ok(!(await db.doc('chatModerationCaseStates/'+c+'/cases/'+id(c,'m02')).get()).exists);
    const accesses=(await db.collection('chatModerationAccessEvents').get()).docs
      .map(d=>d.data()).filter(x=>x.channel===c);
    assert.ok(accesses.length>=3);
    for(const a of accesses){
      equalKeys(a,['moderatorUid','caseId','channel','outcome','accessedAt']);
      assert.equal(a.caseId,id(c));assert.equal(a.outcome,'allowed');
      assert.ok([uid.miguel,uid.lucia].includes(a.moderatorUid));
      assert.ok(a.accessedAt.toDate());
    }
    const events=(await db.collection('chatModerationWorkflowEvents').get()).docs
      .map(d=>d.data()).filter(x=>x.channel===c);
    for(const e of events){
      equalKeys(e,['action','actorUid','caseId','channel','outcome','recordedAt']);
      assert.equal(e.caseId,id(c));assert.equal(e.outcome,'accepted');
      assert.ok(e.recordedAt.toDate());
    }
    for(const [action,actor] of [['triage',uid.miguel],['decide',uid.miguel],
        ['appeal',uid.clara],['review_appeal',uid.lucia]]){
      const found=events.filter(e=>e.action===action);
      assert.equal(found.length,1);assert.equal(found[0].actorUid,actor);
    }
    assert.ok(events.filter(e=>e.action==='state').length>=5);
    console.log('firestore_verify PASS channel='+c+' audit_minimal reports_unchanged no_outside_state');
  }
}
async function serve(){
  const server=createServer({key:readFileSync(keyPath),cert:readFileSync(certPath),
    minVersion:'TLSv1.2'},async(req,res)=>{
    if(mode==='reject'){
      console.log('unexpected_http_request');
      res.writeHead(500).end();return;
    }
    if(req.url==='/health'&&req.method==='GET'){
      res.writeHead(200,{'Cache-Control':'no-store'}).end('ready');return;
    }
    try{
      assert.equal(req.method,'POST');
      assert.ok([basePath,basePath+'/state',basePath+'/action',basePath+'/appeal'].includes(req.url));
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;assert.ok(size<=2048);chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      const fields=JSON.parse(body.toString('utf8'));
      assert.ok(channels.includes(fields.channel));
      const c=fields.channel;
      assert.ok([id(c),id(c,'m02')].includes(fields.caseId));
      const path=req.url===basePath?'open':req.url.slice(basePath.length+1);
      let checks=0,actor=null;
      const dependencies={db,projectId,serverTimestamp:()=>FieldValue.serverTimestamp(),
        verifyIdToken:async(token,checkRevoked)=>{
          assert.equal(checkRevoked,true);checks++;
          const claims=await auth.verifyIdToken(token,checkRevoked);
          actor=claims.uid;return claims;
        }};
      const handler=path==='open'
        ?createScopedModerationHttpHandler(createScopedModerationService(dependencies),{enabled:true})
        :createCaseReviewWorkflowHttpHandler(createCaseReviewWorkflow(dependencies),{enabled:true});
      const response=await handler(new Request(endpoint+(path==='open'?'':'/'+path),{
        method:'POST',headers:{authorization:req.headers.authorization??'',
          'content-type':req.headers['content-type']??''},body
      }));
      assert.equal(checks,1);
      assert.match(response.headers.get('cache-control'),/no-store/);
      const payload=await response.json();
      if(response.status===200){
        if(path==='open'){
          equalKeys(payload,['status','case']);
          equalKeys(payload.case,['caseId','channel','reason','excerpt','reportedAt']);
          assert.equal(payload.case.caseId,id(c));
          assert.equal(payload.case.channel,c);
          assert.equal(payload.case.excerpt,reportData(c).reportedText);
        }else equalKeys(payload,['status','stage']);
      }else{
        assert.equal(response.status,404);
        assert.deepEqual(payload,{status:'case_unavailable'});
      }
      // A fixture privilegiada nunca participa da autorização. Só muda grant
      // APÓS o resultado real esperado e verifica a condição no Firestore.
      if(path==='action'&&fields.action==='review_appeal'&&response.status===404&&
          actor===uid.miguel&&fields.caseId===id(c)){
        const s=(await state(c).get()).data(),g=(await grant(c).get()).data();
        assert.equal(s.stage,'appealed');assert.equal(s.decisionBy,uid.miguel);
        assert.equal(g.moderatorUid,uid.miguel);assert.equal(g.status,'active');
        await grant(c).update({moderatorUid:uid.lucia});
        console.log('fixture channel='+c+' reassigned_after_same_reviewer_denial');
      }
      if(path==='state'&&response.status===200&&payload.stage==='appeal_reviewed'&&actor===uid.lucia){
        const s=(await state(c).get()).data(),g=(await grant(c).get()).data();
        assert.equal(s.appealReviewedBy,uid.lucia);assert.equal(g.moderatorUid,uid.lucia);
        assert.equal(g.status,'active');
        await grant(c).update({status:'revoked'});
        console.log('fixture channel='+c+' revoked_after_review_revalidation');
      }
      console.log('https channel='+c+' route='+path+' status='+response.status+
        ' tls='+req.socket.getProtocol()+' auth_checked=true no_store=true');
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(JSON.stringify(payload));
    }catch{
      console.log('harness_error');res.writeHead(500,{'Cache-Control':'no-store'}).end();
      process.exitCode=1;
    }
  });
  if(mode==='reject'){
    server.on('connection',()=>console.log('tcp_connection'));
    server.on('secureConnection',()=>console.log('tls_handshake_completed'));
  }
  server.on('tlsClientError',()=>console.log('tls_client_error'));
  server.listen(port,host,()=>console.log('listen '+mode+' loopback_only'));
}
try{
  if(mode==='seed'){await seed();await deleteApp(app);}
  else if(mode==='verify'){await verify();await deleteApp(app);}
  else await serve();
}catch{
  console.error('fixture_or_verification_failed');process.exitCode=1;
  await deleteApp(app);
}
