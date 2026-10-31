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

const byId=id=>document.getElementById(id);
const loginForm=byId('login-form');
const actions=byId('account-actions');
const email=byId('email');
const password=byId('password');
const submit=byId('login');
const requestButton=byId('request');
const resetButton=byId('reset');
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
if(!config || config.projectId!==PROJECT ||
   !config.apiKey || !config.authDomain || !config.appId) {
  loginForm.hidden=true;
  say('O canal digital de solicitação ainda não está configurado. Nenhum pedido foi enviado.');
} else {
  try {
    const app=initializeApp(config);
    auth=getAuth(app);
    db=getFirestore(app);
    await setPersistence(auth,inMemoryPersistence);
    say('Entre com a sua conta do Átrio para registrar o pedido.');
  } catch {
    loginForm.hidden=true;
    say('Não foi possível iniciar o formulário. Nenhum pedido foi enviado.');
  }
}

async function checkRequest() {
  if(!user) return;
  serverChecked=false;
  requestButton.hidden=true;
  const ref=doc(db,'account_deletion_requests',user.uid);
  try {
    // A origem obrigatória é o servidor, não uma cópia local potencialmente antiga.
    const snapshot=await getDocFromServer(ref);
    serverChecked=true;
    existing=snapshot.exists();
    if(existing){
      say('Sua solicitação já consta no registro. Isso não significa que os dados foram excluídos.');
    } else {
      requestButton.hidden=false;
      say('Nenhuma solicitação encontrada. Você pode registrar seu pedido.');
    }
  } catch {
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
    // Revalidação contra mudança de sessão/estado antes da gravação.
    if(auth.currentUser?.uid!==user.uid) throw Error('session_changed');
    const ref=doc(db,'account_deletion_requests',user.uid);
    const row=await getDocFromServer(ref);
    if(!row.exists()){
      await setDoc(ref,{
        status:'requested',source:'web',requestedAt:serverTimestamp()
      });
    }
    existing=true;
    requestButton.hidden=true;
    say('Solicitação registrada. A conta permanece ativa enquanto o processamento é analisado.');
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
    email.value='';password.value='';
    requestButton.hidden=true;
    lock(false);
    say('Sessão encerrada. Nenhum dado de acesso foi mantido no navegador.');
  }
});
