// QA sob demanda: acionado exclusivamente pela fila Cloudflare privada.
// Não há endpoint público, cron ou interação com publicações de membros.
const PROJECT = 'atrio-catolico';
const ROOT = 'https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents';
export const QA_BOTS = Object.freeze([
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
  if(!/^[a-z0-9_-]{8,64}$/.test(requestId)) throw Error('invalid_request_id');
  const when=now.toISOString();
  const [clara,miguel,lucia]=QA_BOTS;
  const idx=[...requestId].reduce((s,x)=>s+x.charCodeAt(0),0)%topic.length;
  const [title,body]=topic[idx];
  const postId='qa_'+requestId;
  const base=ROOT+'/posts/'+postId;
  const reply=(id,bot,text)=>doc(base+'/replies/'+id,{
    uid:str(bot.uid),authorName:str(bot.name),body:str(marker+text),createdAt:timestamp(when),
  });
  const notice=(id,bot)=>doc(ROOT+'/users/'+clara.uid+'/notifications/'+id,{
    postId:str(postId),replyId:str(id),actorUid:str(bot.uid),
    actorName:str(bot.name),read:{booleanValue:false},createdAt:timestamp(when),
  });
  const writes=[
    doc(ROOT+'/qa_bot_runs/'+requestId,{
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
async function getDocument(token,path){
  const res=await fetch(ROOT+'/'+path,{headers:{Authorization:'Bearer '+token}});
  if(res.status===404)return null;
  if(!res.ok)throw Error('qa_firestore_read_failed');
  return res.json();
}
async function createProfile(token,bot,now){
  const existing=await getDocument(token,'profiles/'+bot.uid);
  if(existing){
    if(existing.fields?.displayName?.stringValue!==bot.name)throw Error('qa_profile_conflict');
    return;
  }
  const res=await fetch(ROOT+'/profiles?documentId='+bot.uid,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({fields:{
      displayName:str(bot.name),
      bio:str('Conta de simulação interna de QA; não representa uma pessoa real.'),
      createdAt:timestamp(now.toISOString()),
    }}),
  });
  if(res.status===409){
    const conflict=await getDocument(token,'profiles/'+bot.uid);
    if(conflict?.fields?.displayName?.stringValue===bot.name)return;
  }
  if(!res.ok)throw Error('qa_profile_create_failed');
}
export function validQaCommand(command,now=Date.now()){
  return command && typeof command==='object'&&!Array.isArray(command) &&
    Object.keys(command).sort().join(',')==='createdAt,kind,requestId' &&
    command.kind==='manual_chat_qa_v1' &&
    typeof command.requestId==='string' &&
    /^[a-z0-9_-]{8,64}$/.test(command.requestId) &&
    typeof command.createdAt==='string' &&
    Number.isFinite(Date.parse(command.createdAt)) &&
    Math.abs(now-Date.parse(command.createdAt))<10*60_000;
}
export async function executeQaCommand(command,env,serviceToken,now=new Date()){
  if(env.QA_MANUAL_ENABLED!=='true')return 'disabled';
  if(!validQaCommand(command,now.valueOf()))return 'invalid_command';
  const prior=await getDocument(serviceToken,'qa_bot_runs/'+command.requestId);
  if(prior)return 'already_completed';
  for(const bot of QA_BOTS)await createProfile(serviceToken,bot,now);
  const {writes}=planQaSession(command.requestId,now);
  const response=await fetch(ROOT+':commit',{
    method:'POST',headers:{Authorization:'Bearer '+serviceToken,'Content-Type':'application/json'},
    body:JSON.stringify({writes}),
  });
  if(!response.ok){
    if(await getDocument(serviceToken,'qa_bot_runs/'+command.requestId))
      return 'already_completed';
    throw Error('qa_commit_failed');
  }
  return 'created';
}
