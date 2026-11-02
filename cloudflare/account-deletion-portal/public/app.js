// Portal público separado do APK. Nenhum dado de senha é enviado ao Átrio,
// Cloudflare, analytics ou terceiros além do serviço de autenticação Firebase.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, setPersistence, inMemoryPersistence, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore, doc, getDocFromServer, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

import {verifiedPortalDeletionRequest} from './deletion-request-state.js';

const byId=id=>document.getElementById(id);
const loginForm=byId('login-form');
const actions=byId('account-actions');
const email=byId('email');
const password=byId('password');
const submit=byId('login');
const requestButton=byId('request');
const resetButton=byId('reset');
const resetRow=byId('reset-row');
const logoutButton=byId('logout');
const feedback=byId('feedback');
const PROJECT='atrio-catolico';
let auth,db,user=null,busy=false,existing=false,serverChecked=false;
const say=message=>{feedback.textContent=message;};
function lock(value) {
  busy=value;
  for(const button of [submit,requestButton,resetButton,logoutButton]) button.disabled=value;
}
const config=window.ATRIO_FIREBASE_CONFIG;
// Requer ALTERACAO DE CODIGO e revisao independente antes de aceitar pedidos
// pela web; modificar apenas um arquivo de configuracao nao pode desbloquear.
const LIVE_INTAKE_REVIEWED_AND_APPROVED=false;
const intakeEnabled=LIVE_INTAKE_REVIEWED_AND_APPROVED &&
  window.ATRIO_PORTAL_STATUS?.intakeEnabled===true &&
  window.ATRIO_PORTAL_STATUS?.actualDeletionEnabled===true;
if(!intakeEnabled) {
  // Read-only information page. No sign-in, password reset or Firestore writes.
  loginForm.hidden=true;
  actions.hidden=true;
  say('O formulário de exclusão pela web ainda não está disponível. Nenhum pedido foi enviado.');
} else if(!config || config.projectId!==PROJECT ||
   !config.apiKey || !config.authDomain || !config.appId) {
  loginForm.hidden=true;
  say('O canal digital de solicitação ainda não está configurado. Nenhum pedido foi enviado.');
} else {
  try {
    const app=initializeApp(config);
    auth=getAuth(app);
    db=getFirestore(app);
    await setPersistence(auth,inMemoryPersistence);
    loginForm.hidden=false;
    resetRow.hidden=false;
    say('Entre com a sua conta do Átrio para registrar o pedido.');
  } catch {
    loginForm.hidden=true;
    say('Não foi possível iniciar o formulário. Nenhum pedido foi enviado.');
  }
}

async function checkRequest() {
  if(!user) return;
  const requestUid=user.uid;
  serverChecked=false;
  requestButton.hidden=true;
  const ref=doc(db,'account_deletion_requests',requestUid);
  try {
    // getDocFromServer pode refletir escrita local pendente: exija ACK remoto.
    const snapshot=await getDocFromServer(ref);
    if(auth.currentUser?.uid!==requestUid || user?.uid!==requestUid) return;
    if(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
      throw Error('request_not_confirmed_by_server');
    serverChecked=true;
    existing=snapshot.exists();
    if(existing){
      say(verifiedPortalDeletionRequest(snapshot)
        ? 'Sua solicitação está confirmada no servidor. Isso não significa que os dados foram excluídos.'
        : 'Existe um registro, mas o pedido não pôde ser validado. Nenhuma exclusão foi comprovada.');
    } else {
      requestButton.hidden=false;
      say('Nenhuma solicitação encontrada. Você pode registrar seu pedido.');
    }
  } catch {
    if(auth.currentUser?.uid!==requestUid || user?.uid!==requestUid) return;
    serverChecked=false;
    requestButton.hidden=true;
    say('Não foi possível confirmar o estado do pedido. Verifique sua conexão e tente entrar novamente.');
  }
}

loginForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!auth || busy) return;
  const address=email.value.trim();
  const pass=password.value;
  if(!address.includes('@')||pass.length<6){say('Informe o e-mail cadastrado e a senha.');return;}
  lock(true);
  try {
    const result=await signInWithEmailAndPassword(auth,address,pass);
    password.value='';
    user=result.user;
    loginForm.hidden=true;
    resetRow.hidden=true;
    actions.hidden=false;
    existing=false;
    await checkRequest();
  }catch{
    password.value='';
    say('Não foi possível autenticar. Confira os dados e a conexão.');
  }finally{lock(false);}
});

resetButton.addEventListener('click',async()=>{
  if(!auth||busy) return;
  const address=email.value.trim();
  if(!address.includes('@')){say('Informe seu e-mail cadastrado antes de recuperar a senha.');return;}
  lock(true);
  try {
    await sendPasswordResetEmail(auth,address);
  } catch {
    // Não confirmar a existência ou ausência de conta em mensagens públicas.
  } finally {
    lock(false);
    say('Se o e-mail informado estiver habilitado, você receberá instruções de recuperação.');
  }
});

requestButton.addEventListener('click',async()=>{
  if(!auth||!db||!user||busy||existing||!serverChecked) return;
  if(!window.confirm('Deseja registrar a solicitação de exclusão da sua conta? A exclusão não ocorrerá imediatamente.')) return;
  lock(true);
  try {
    // Revalidação contra mudança de sessão/estado antes e depois da gravação.
    const requestUid=user.uid;
    if(auth.currentUser?.uid!==requestUid) throw Error('session_changed');
    const ref=doc(db,'account_deletion_requests',requestUid);
    const row=await getDocFromServer(ref);
    if(auth.currentUser?.uid!==requestUid || user?.uid!==requestUid)
      throw Error('session_changed');
    if(row.metadata.fromCache || row.metadata.hasPendingWrites)
      throw Error('request_not_confirmed_by_server');
    if(row.exists() && !verifiedPortalDeletionRequest(row))
      throw Error('existing_request_invalid');
    if(!row.exists()){
      await setDoc(ref,{
        status:'requested',source:'web',requestedAt:serverTimestamp()
      });
    }
    // A confirmação é lida novamente do servidor; sucesso local não basta.
    const confirmation=await getDocFromServer(ref);
    if(auth.currentUser?.uid!==requestUid || user?.uid!==requestUid
      || !verifiedPortalDeletionRequest(confirmation))
      throw Error('request_confirmation_missing');
    existing=true;
    requestButton.hidden=true;
    say('Solicitação confirmada no servidor. A conta permanece ativa enquanto o processamento é analisado.');
  }catch {
    // Jamais afirmar que registrou quando a gravação é incerta.
    serverChecked=false;
    requestButton.hidden=true;
    say('Não foi possível confirmar o registro. Entre novamente para verificar o estado.');
  }finally{lock(false);}
});

logoutButton.addEventListener('click',async()=>{
  if(!auth||busy) return;
  lock(true);
  try{await signOut(auth);}
  finally{
    user=null;existing=false;serverChecked=false;
    actions.hidden=true;loginForm.hidden=false;
    resetRow.hidden=false;
    email.value='';password.value='';
    requestButton.hidden=true;
    lock(false);
    say('Sessão encerrada. Nenhum dado de acesso foi mantido no navegador.');
  }
});
