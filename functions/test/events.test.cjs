"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {replyRecipient,badgeEvents,reportAllowed,activeAdmins,recentTokens,
  dispatchId,safeKind,millis} = require("../events");
const at=n=>({toMillis:()=>n});
test("respostas: envia só para UID dono e não notifica autor",()=>{
  const data={postId:"post01",replyId:"reply01",actorUid:"bob",read:false,createdAt:at(10)};
  assert.equal(replyRecipient(data,"alice","reply01"),"alice");
  assert.equal(replyRecipient({...data,read:true},"alice","reply01"),null);
  assert.equal(replyRecipient({...data,actorUid:"alice"},"alice","reply01"),null);
  assert.equal(replyRecipient(data,"alice","outro"),null);
  assert.equal(replyRecipient({...data,postId:"posts/ab"},"alice","reply01"),null);
  assert.equal(replyRecipient({...data,createdAt:null},"alice","reply01"),null);
});
test("pedido clerical novo ou reapresentado aciona aviso só ao administrador",()=>{
  const pending={status:"pending",kind:"padre",createdAt:at(10)};
  assert.deepEqual(badgeEvents(undefined,pending,"alice"),
    [{kind:"admin",excludeUid:"alice",recipient:null}]);
  assert.equal(badgeEvents({status:"rejected"},pending,"alice")[0].kind,"admin");
  assert.deepEqual(badgeEvents(pending,pending,"alice"),[]);
});
test("aprovação e rejeição avisam somente o titular",()=>{
  const pending={status:"pending",kind:"diacono",createdAt:at(10)};
  for(const status of ["approved","rejected"]){
    const res=badgeEvents(pending,{...pending,status,reviewedBy:"admin",reviewedAt:at(20)},"alice");
    assert.deepEqual(res,[{kind:"review",recipient:"alice"}]);
  }
  assert.deepEqual(badgeEvents({status:"approved"},{...pending,status:"approved",reviewedAt:at(20),reviewedBy:"admin"},"alice"),[]);
  assert.deepEqual(badgeEvents(pending,{...pending,status:"approved"},"alice"),[]);
});
test("invalidade de pedidos não gera aviso",()=>{
  assert.deepEqual(badgeEvents(null,{status:"pending",kind:"moderador",createdAt:at(10)},"alice"),[]);
  assert.deepEqual(badgeEvents(null,{status:"pending",kind:"padre"},"alice"),[]);
});
test("denúncias não incluem conteúdo privado e só pendências válidas",()=>{
  const report={postId:"p",reporterUid:"bob",createdAt:at(10)};
  assert.equal(reportAllowed(report),true);
  assert.equal(reportAllowed({...report,status:"dismissed"}),false);
  assert.equal(reportAllowed({...report,reporterUid:""}),false);
  assert.equal(reportAllowed({...report,postId:"bad/ref"}),false);
});
test("administradores revogados e autor da própria denúncia são excluídos",()=>{
  const admins=[{uid:"adminA",enabled:true},{uid:"adminB",enabled:false},{uid:"bob",enabled:true}];
  assert.deepEqual(activeAdmins(admins,"bob"),["adminA"]);
  assert.deepEqual(activeAdmins(Array(31).fill({uid:"adminA",enabled:true}),"x"),[]);
});
test("somente tokens recentes e válidos recebem mensagem",()=>{
  const now=150*86400000;
  const docs=[
    {token:"token_celular_A_123456789",updatedAt:at(now-1000)},
    {token:"token_celular_A_123456789",updatedAt:at(now-2000)},
    {token:"token_celular_B_123456789",updatedAt:at(now-61*86400000)},
    {token:"curto",updatedAt:at(now-1000)},
  ];
  assert.deepEqual(recentTokens(docs,now),["token_celular_A_123456789"]);
});
test("deduplicação por evento e destinatário, sem exposição de UID",()=>{
  const id=dispatchId("cloud-event-01","alice");
  assert.equal(id.length,64);
  assert.equal(id.includes("alice"),false);
  assert.equal(id,dispatchId("cloud-event-01","alice"));
  assert.notEqual(id,dispatchId("cloud-event-01","bob"));
  assert.notEqual(id,dispatchId("cloud-event-02","alice"));
  assert.throws(()=>dispatchId("cloud-event-01","bad/uid"));
});
test("tipos do payload são uma lista fechada",()=>{
  for(const kind of ["reply","review","admin"]) assert.equal(safeKind(kind),true);
  assert.equal(safeKind("message"),false);
  assert.equal(safeKind("password"),false);
  assert.equal(millis({toMillis:()=>Infinity}),0);
});
