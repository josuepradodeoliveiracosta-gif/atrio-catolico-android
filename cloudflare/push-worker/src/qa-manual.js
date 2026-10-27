import {signInQaBot} from './qa-real-auth.js';
// QA manual na comunidade oficial: identidades Firebase Auth reais.
// Firestore REST recebe ID tokens de usuários e aplica as regras comuns.
// Sem endpoint público, sem Cron, sem contas de administração.
const PROJECT='atrio-catolico';
const DOC='projects/'+PROJECT+'/databases/(default)/documents';
const ROOT='https://firestore.googleapis.com/v1/'+DOC;
export const QA_BOTS=Object.freeze([
  {uid:'qa_clara_v19',name:'Clara (BOT DE TESTE)'},
  {uid:'qa_miguel_v19',name:'Miguel (BOT DE TESTE)'},
  {uid:'qa_lucia_v19',name:'Lúcia (BOT DE TESTE)'},
]);
const str=s=>({stringValue:s});
const timestamp=s=>({timestampValue:s});
const doc=(name,fields)=>({update:{name,fields},currentDocument:{exists:false}});
const marker='[SIMULAÇÃO — BOT DE TESTE] ';
const topic=[
  ['Acolhimento na comunidade','Como podemos acolher novos membros com respeito e caridade?'],
  ['Conversa sobre oração','Quais atitudes ajudam a tornar um encontro de oração mais acolhedor?'],
  ['Solidariedade na comunidade','Como incentivar pequenos gestos de solidariedade entre os membros?'],
];
export function planQaSession(requestId,now=new Date()) {
  if(!/^[a-z0-9_-]{8,64}$/.test(requestId))throw Error('invalid_request_id');
  const when=now.toISOString();
  const [clara,miguel,lucia]=QA_BOTS;
  const idx=[...requestId].reduce((s,x)=>s+x.charCodeAt(0),0)%topic.length;
  const [title,body]=topic[idx];
  const postId='qa_'+requestId;
  const base=DOC+'/posts/'+postId;
  const reply=(id,bot,text)=>doc(base+'/replies/'+id,{
    uid:str(bot.uid),authorName:str(bot.name),
    body:str(marker+text),createdAt:timestamp(when),
  });
  const notice=(id,bot)=>doc(DOC+'/users/'+clara.uid+'/notifications/'+id,{
    postId:str(postId),replyId:str(id),actorUid:str(bot.uid),
    actorName:str(bot.name),read:{booleanValue:false},
    createdAt:timestamp(when),
  });
  const writes=[
    doc(DOC+'/qa_bot_runs/'+requestId,{
      status:str('created'),postId:str(postId),createdAt:timestamp(when),
      kind:str('on_demand_chat_qa'),
    }),
    doc(base,{
      uid:str(clara.uid),authorName:str(clara.name),
      title:str(marker+title),body:str(marker+body),
      category:str('Vida espiritual'),createdAt:timestamp(when),
    }),
    reply('qa_miguel',miguel,'A escuta respeitosa ajuda a criar um ambiente acolhedor.'),
    reply('qa_lucia',lucia,'Concordo. É importante conversar com paciência e respeito.'),
    notice('qa_miguel',miguel),notice('qa_lucia',lucia),
  ];
  return {postId,writes};
}
function withServerTime(write) {
  const fields={...write.update.fields};
  delete fields.createdAt;
  return {
    update:{name:write.update.name,fields},
    currentDocument:{exists:false},
    updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}],
  };
}
async function getDocument(token,path) {
  const response=await fetch(ROOT+'/'+path,{headers:{Authorization:'Bearer '+token}});
  if(response.status===404)return null;
  if(!response.ok)throw Error('qa_firestore_read_failed');
  return response.json();
}
async function commit(token,writes) {
  const response=await fetch(ROOT+':commit',{
    method:'POST',headers:{Authorization:'Bearer '+token,
      'Content-Type':'application/json'},
    body:JSON.stringify({writes}),
  });
  return response.ok;
}
function fieldsMatch(actual,expected) {
  if(!actual?.fields?.createdAt?.timestampValue)return false;
  return Object.entries(expected).every(([field,value])=>
    field==='createdAt'||JSON.stringify(actual.fields[field])===JSON.stringify(value));
}
async function commitOrValidate(token,writes,lookups) {
  if(await commit(token,writes.map(withServerTime)))return;
  // Mesmo pedido após erro de rede: só aceitar dados exatos previamente gravados.
  const existing=await Promise.all(lookups.map(p=>getDocument(token,p)));
  if(existing.every((entry,index)=>fieldsMatch(entry,writes[index].update.fields)))
    return;
  throw Error('qa_authenticated_write_failed');
}
async function ensureProfile(token,bot) {
  const path='profiles/'+bot.uid;
  const fields={displayName:str(bot.name)};
  const existing=await getDocument(token,path);
  if(existing){
    if(existing.fields?.displayName?.stringValue!==bot.name)
      throw Error('qa_profile_conflict');
    return;
  }
  await commitOrValidate(token,[doc(DOC+'/'+path,fields)],[path]);
}
export function validQaCommand(command,now=Date.now()){
  return Boolean(command&&typeof command==='object'&&!Array.isArray(command)&&
    Object.keys(command).sort().join(',')==='createdAt,kind,requestId'&&
    command.kind==='manual_chat_qa_v1'&&
    typeof command.requestId==='string'&&
    /^[a-z0-9_-]{8,64}$/.test(command.requestId)&&
    typeof command.createdAt==='string'&&
    Number.isFinite(Date.parse(command.createdAt))&&
    Math.abs(now-Date.parse(command.createdAt))<10*60_000);
}
async function startRun(serviceToken,command,postId,when) {
  const path='qa_bot_runs/'+command.requestId;
  const old=await getDocument(serviceToken,path);
  if(old) {
    if(old.fields?.status?.stringValue==='created')return 'already_completed';
    if(old.fields?.status?.stringValue!=='started'||
      old.fields?.postId?.stringValue!==postId)
      throw Error('qa_marker_conflict');
    return 'resume';
  }
  const started=doc(DOC+'/'+path,{
    status:str('started'),postId:str(postId),
    kind:str('on_demand_auth_qa'),createdAt:timestamp(when),
  });
  if(await commit(serviceToken,[started]))return 'started';
  const raced=await getDocument(serviceToken,path);
  if(raced?.fields?.postId?.stringValue===postId&&
    raced.fields?.status?.stringValue==='started')return 'resume';
  if(raced?.fields?.status?.stringValue==='created')return 'already_completed';
  throw Error('qa_marker_unavailable');
}
async function finishRun(serviceToken,command) {
  const name=DOC+'/qa_bot_runs/'+command.requestId;
  const result=await fetch(ROOT+'/qa_bot_runs/'+command.requestId+
    '?updateMask.fieldPaths=status&updateMask.fieldPaths=finishedAt',{
    method:'PATCH',headers:{Authorization:'Bearer '+serviceToken,
      'Content-Type':'application/json'},
    body:JSON.stringify({name,fields:{
      status:str('created'),finishedAt:timestamp(new Date().toISOString()),
    }}),
  });
  if(!result.ok)throw Error('qa_marker_finalize_failed');
}
export async function executeQaCommand(command,env,serviceToken,now=new Date()) {
  if(env.QA_MANUAL_ENABLED!=='true')return 'disabled';
  if(!validQaCommand(command,now.valueOf()))return 'invalid_command';
  const {postId,writes}=planQaSession(command.requestId,now);
  const run=await startRun(serviceToken,command,postId,now.toISOString());
  if(run==='already_completed')return 'already_completed';

  // Custom sign-in cria/recupera usuários reais do Firebase Auth.
  // Token de cada bot é usado nas leituras/gravações do próprio usuário.
  const tokens={};
  for(const bot of QA_BOTS) {
    tokens[bot.uid]=await signInQaBot(env,bot.uid);
    await ensureProfile(tokens[bot.uid],bot);
  }
  const [clara,miguel,lucia]=QA_BOTS;
  const tokenClara=tokens[clara.uid];
  const tokenMiguel=tokens[miguel.uid];
  const tokenLucia=tokens[lucia.uid];
  await commitOrValidate(tokenClara,[writes[1]],['posts/'+postId]);
  await commitOrValidate(tokenMiguel,[writes[2],writes[4]],[
    'posts/'+postId+'/replies/qa_miguel',
    'users/'+clara.uid+'/notifications/qa_miguel',
  ]);
  await commitOrValidate(tokenLucia,[writes[3],writes[5]],[
    'posts/'+postId+'/replies/qa_lucia',
    'users/'+clara.uid+'/notifications/qa_lucia',
  ]);
  // Curtir e salvar como usuários autênticos, visíveis no mesmo app.
  await commitOrValidate(tokenMiguel,[doc(DOC+'/users/'+miguel.uid+
    '/likedPosts/'+postId,{})],['users/'+miguel.uid+'/likedPosts/'+postId]);
  await commitOrValidate(tokenLucia,[doc(DOC+'/users/'+lucia.uid+
    '/savedPosts/'+postId,{})],['users/'+lucia.uid+'/savedPosts/'+postId]);
  await finishRun(serviceToken,command);
  return 'created';
}
