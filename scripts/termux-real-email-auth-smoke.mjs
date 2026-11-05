#!/usr/bin/env node
/**
 * Teste REAL e com privacidade do portao de e-mail do Atrio Catolico.
 *
 * - Reutiliza OAuth ja ativo no Firebase CLI para descobrir a API key Android
 *   na memoria, nunca imprime essa key, tokens, senha, UID ou e-mail.
 * - Credenciais de DUAS contas de QA sao digitadas no Termux, sem eco.
 * - Nao cria contas, altera documentos, publica regras ou aciona envios FCM.
 * - Login autentico pode atualizar apenas metadados normais de ultimo acesso.
 * - Push recebe postId aleatorio inexistente. O codigo atual retorna 'ignored'
 *   sem efetuar qualquer escrita quando a publicacao nao existe.
 * - Nenhum arquivo, snapshot ou backup e criado/alterado.
 */
import {randomUUID} from 'node:crypto';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';
const project='atrio-catolico';
const packageName='br.com.atriocatolico';
const firestoreRoot='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents/';
const managementRoot='https://firebase.googleapis.com/v1beta1/projects/'+project+'/androidApps';
const authRoot='https://identitytoolkit.googleapis.com/v1';
const avatarRoot='https://atrio-avatares.atrio-catolico.workers.dev';
const pushRoot='https://atrio-push.atrio-catolico.workers.dev';
const policyVersion='2026-11-v1';
const fail=reason=>{throw Error('atrio_real_auth_qa_'+reason);};

async function request(url,{method='GET',token,body,oauth,qaDiagnostic=false}={},fetcher=fetch){
  let r;
  try {
    r=await fetcher(url,{
      method,redirect:'error',cache:'no-store',
      headers:{
        Accept:'application/json',
        ...(body?{'Content-Type':'application/json'}:{}),
        ...(token?{Authorization:'Bearer '+token}:{}),
        ...(oauth?{Authorization:'Bearer '+oauth}:{}),
        ...(qaDiagnostic?{'X-Atrio-QA-Diagnostic':'1'}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(12000)
    });
  }catch{fail('network_unavailable');}
  return r;
}

async function responseJson(r){
  try {
    const raw=await r.text();
    if(raw.length>160000)fail('response_too_large');
    return JSON.parse(raw);
  }catch{fail('invalid_response');}
}

export async function findAndroidApiKey(oauth,fetcher=fetch){
  if(typeof oauth!=='string'||oauth.length<20)fail('missing_admin_session');
  const list=await request(managementRoot,{oauth},fetcher);
  if(!list.ok)fail('android_configuration_unavailable');
  const json=await responseJson(list);
  if(json.nextPageToken)fail('ambiguous_android_apps');
  const apps=(json.apps||[]).filter(a=>a.packageName===packageName&&
    a.state!=='DELETED'&&typeof a.appId==='string');
  if(apps.length!==1)fail('android_application_not_unique');
  const id=apps[0].appId;
  if(!/^[0-9]+:[0-9]+:android:[a-f0-9]+$/i.test(id))
    fail('invalid_android_app_id');
  const config=await request(managementRoot+'/'+encodeURIComponent(id)+'/config',
    {oauth},fetcher);
  if(!config.ok)fail('android_configuration_unavailable');
  const wrapped=await responseJson(config);
  if(typeof wrapped.configFileContents!=='string' ||
     wrapped.configFileContents.length>150000)fail('invalid_android_config');
  let decoded;
  try {decoded=JSON.parse(Buffer.from(wrapped.configFileContents,'base64').toString('utf8'));}
  catch{fail('invalid_android_config');}
  if(decoded.project_info?.project_id!==project || !Array.isArray(decoded.client))
    fail('wrong_firebase_project');
  const keys=decoded.client.filter(c=>
    c.client_info?.android_client_info?.package_name===packageName)
    .flatMap(c=>c.api_key||[]).map(k=>k.current_key)
    .filter(k=>typeof k==='string' && /^AIza[0-9A-Za-z_-]{30,}$/.test(k));
  if(new Set(keys).size!==1)fail('android_api_key_not_unique');
  return keys[0];
}

export async function signInQa(apiKey,email,password,fetcher=fetch){
  if(!/^AIza[0-9A-Za-z_-]{30,}$/.test(apiKey))fail('invalid_api_key');
  if(typeof email!=='string'||!email.includes('@')||email.length>254||
    typeof password!=='string'||password.length<6||password.length>256)
    fail('invalid_qa_credentials');
  const signed=await request(authRoot+'/accounts:signInWithPassword?key='+apiKey,{
    method:'POST',body:{email,password,returnSecureToken:true}
  },fetcher);
  if(!signed.ok)fail('qa_signin_failed');
  const data=await responseJson(signed);
  if(typeof data.idToken!=='string'||data.idToken.length<100||
    typeof data.localId!=='string'||data.localId.length<1)
    fail('qa_invalid_signin');
  const lookup=await request(authRoot+'/accounts:lookup?key='+apiKey,{
    method:'POST',body:{idToken:data.idToken}
  },fetcher);
  if(!lookup.ok)fail('qa_lookup_failed');
  const details=await responseJson(lookup);
  const user=details.users?.[0];
  if(!user||user.disabled||user.localId!==data.localId)
    fail('qa_identity_mismatch');
  return {idToken:data.idToken,emailVerified:user.emailVerified===true};
}

export function evaluateQaStatuses({policyState,verified,results}){
  if(!['ACTIVE','MISSING'].includes(policyState))fail('policy_not_ready_for_qa');
  if(typeof verified!=='boolean')fail('verification_state_undefined');
  const shouldBlock=policyState==='ACTIVE'&&!verified;
  const expected={
    firestore:shouldBlock?[403]:[404],
    avatar:shouldBlock?[401]:[400,403],
    push:shouldBlock?[401]:[202]
  };
  const checks=Object.entries(expected).map(([name,accepted])=>({
    service:name,expectedHttp:accepted,actualHttp:results?.[name]??null,
    pass:accepted.includes(results?.[name])
  }));
  return {policyState,emailVerified:verified,
    allPassed:checks.every(c=>c.pass),checks};
}

/** Só faz leituras e duas sondas de autorização sem documentos existentes. */
export async function runRealAccountQa({
  apiKey,email,password,expectedPolicy,expectedVerified,
  fetcher=fetch,randomId=randomUUID
}){
  if(!['MISSING','ACTIVE'].includes(expectedPolicy)||typeof expectedVerified!=='boolean')
    fail('invalid_qa_expectation');
  const signed=await signInQa(apiKey,email,password,fetcher);
  if(signed.emailVerified!==expectedVerified)fail('account_verification_mismatch');

  const policy=await request(firestoreRoot+'app_config/email_verification',
    {token:signed.idToken},fetcher);
  let policyState;
  if(policy.status===404)policyState='MISSING';
  else if(policy.status===200){
    const data=await responseJson(policy);
    policyState=data.fields?.enabled?.booleanValue===true &&
      data.fields?.version?.stringValue===policyVersion?'ACTIVE':'OTHER';
  } else fail('cannot_read_policy_as_user');
  if(policyState!==expectedPolicy)fail('unexpected_production_policy');

  // GET inexistente nao pode alterar Firestore; politica ativa bloqueia
  // nao verificados antes do teste de existencia do documento.
  const nonexistent='atrio-qa-nonexistent-'+randomId();
  if(!/^atrio-qa-nonexistent-[a-f0-9-]{36}$/.test(nonexistent))
    fail('invalid_test_id');
  const firestore=await request(firestoreRoot+'posts/'+nonexistent,
    {token:signed.idToken},fetcher);

  // Consulta GET sem parametros validos; apos autenticar, apenas
  // valida permissao de moderacao e responde 400/403, sem acesso a imagem.
  const avatar=await request(avatarRoot+'/avatar/moderation/preview',
    {token:signed.idToken},fetcher);

  // O Guardiao consulta um post aleatorio inexistente e retorna 202 ignored.
  // Sem endereco real, nao cria relato, nao envia push nem altera moderacao.
  const push=await request(pushRoot+'/moderation/event',{
    method:'POST',token:signed.idToken,qaDiagnostic:true,
    body:{type:'post',postId:nonexistent}
  },fetcher);
  const result=evaluateQaStatuses({policyState,verified:signed.emailVerified,
    results:{firestore:firestore.status,avatar:avatar.status,push:push.status}});
  if(push.status===503) {
    let diagnostic='unclassified_503';
    try{
      const payload=await responseJson(push);
      const value=payload?.qaDiagnostic;
      if(typeof value==='string' &&
        /^(?:policy_service_oauth_failed|policy_timeout|policy_fetch_runtime_cache|policy_fetch_failed|policy_http_(?:401|403|429|500|502|503|504|other)|policy_invalid_response)$/.test(value))
        diagnostic=value;
    }catch{/* Nao imprimir o corpo HTTP bruto nem tokens. */}
    result.pushDiagnostic=diagnostic;
  }
  return result;
}

/** Credenciais inseridas no terminal em modo raw, sem eco nem logs. */
async function hiddenPrompt(label){
  if(!process.stdin.isTTY || typeof process.stdin.setRawMode!=='function')
    fail('interactive_termux_required');
  return new Promise((resolve,reject)=>{
    let value='';
    const wasRaw=process.stdin.isRaw||false;
    process.stdout.write(label+' (entrada oculta): ');
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    function finish(error){
      process.stdin.removeListener('data',onData);
      process.stdin.setRawMode(wasRaw);
      process.stdout.write('\n');
      if(error)reject(error);else resolve(value);
    }
    function onData(chunk){
      for(const c of chunk){
        if(c==='\r'||c==='\n'){finish();return;}
        if(c==='\u0003'){finish(Error('cancelled'));return;}
        if(c==='\u007f'||c==='\b'){value=value.slice(0,-1);continue;}
        if(c>=' '&&value.length<256)value+=c;
      }
    }
    process.stdin.on('data',onData);
  });
}

if(process.argv[1]&&import.meta.url==='file://'+process.argv[1]){
  try {
    const args=process.argv.slice(2);
    if(args.length!==2||!['--policy=MISSING','--policy=ACTIVE'].includes(args[0])||
       !['--user=verified','--user=unverified'].includes(args[1]))
      fail('usage_policy_and_user_required');
    const expectedPolicy=args[0].slice(9);
    const expectedVerified=args[1]==='--user=verified';
    // A chave publicamente identificadora do Firebase e lida via sessao
    // administrativa existente, nunca solicitada no chat ou impressa.
    const oauth=await accessTokenFromExistingFirebaseCli();
    const apiKey=await findAndroidApiKey(oauth);
    console.log('Configuração Firebase localizada. Informe apenas uma conta de QA.');
    const email=await hiddenPrompt('E-mail de teste');
    const password=await hiddenPrompt('Senha de teste');
    const result=await runRealAccountQa({
      apiKey,email,password,expectedPolicy,expectedVerified
    });
    console.log(JSON.stringify(result,null,2));
    if(!result.allPassed)process.exitCode=2;
  }catch(e){
    const safe=/^atrio_(real_auth_qa|termux_preflight)_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'atrio_real_auth_qa_failed_closed';
    console.error(safe);
    process.exitCode=1;
  }
}
