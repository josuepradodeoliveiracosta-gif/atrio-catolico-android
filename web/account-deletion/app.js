import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, setPersistence, inMemoryPersistence, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore, doc, getDocFromServer, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

/*
 * Esta página exige login Firebase real. Nenhum e-mail, senha ou token
 * é enviado ao GitHub, ao Cloudflare ou a um administrador por formulário.
 * Firebase salva uma única solicitação ligada ao UID autenticado.
 */
const $ = id => document.getElementById(id);
const message = text => { $('status').textContent = text; };
const enabled = window.ATRIO_ACCOUNT_DELETION_REQUESTS_ENABLED === true;
const config = window.ATRIO_FIREBASE_CONFIG;
const configured = enabled && config && typeof config === 'object' &&
  config.projectId === 'atrio-catolico' &&
  typeof config.apiKey === 'string' && config.apiKey.length > 10 &&
  typeof config.appId === 'string' && config.appId.length > 10 &&
  typeof config.authDomain === 'string' &&
  config.authDomain.endsWith('.firebaseapp.com') &&
  config.authDomain === 'atrio-catolico.firebaseapp.com';

if (!configured) {
  // Falha fechada: publicar os arquivos por engano não habilita solicitações.
  message('Serviço de exclusão ainda não habilitado. Nenhuma solicitação foi registrada.');
} else {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  $('login').disabled = false;
  $('reset').disabled = false;
  message('Entre com sua conta para consultar ou registrar a solicitação.');

  let currentUser = null;
  let existing = false;
  let busy = false;
  const accountPanel = $('account-panel');
  const setBusy = value => {
    busy = value;
    $('login').disabled = value;
    $('reset').disabled = value;
    $('request').disabled = value || existing;
  };
  const userRequestRef = () => doc(db, 'account_deletion_requests', currentUser.uid);

  async function fetchRequest() {
    const result = await getDocFromServer(userRequestRef());
    existing = result.exists();
    $('request').disabled = existing;
    if (existing) {
      message('Seu pedido já está registrado. Ele não significa que a conta foi excluída.');
    } else {
      message('Você pode registrar um pedido. A conta permanecerá ativa durante a análise.');
    }
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || currentUser) return;
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email || password.length < 6 || email.length > 150 || password.length > 128) return;
    setBusy(true);
    try {
      // Não persistir sessão no navegador, nem em localStorage nem IndexedDB.
      await setPersistence(auth, inMemoryPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      currentUser = credential.user;
      $('password').value = '';
      $('email').value = '';
      accountPanel.hidden = false;
      $('login-form').hidden = true;
      $('reset').hidden = true;
      $('signed-in-text').textContent = 'Identidade autenticada.';
      await fetchRequest();
    } catch (_) {
      message('Não foi possível confirmar a identidade ou consultar a solicitação.');
      if (currentUser) {
        await signOut(auth).catch(() => {});
        currentUser = null;
        accountPanel.hidden = true;
        $('login-form').hidden = false;
        $('reset').hidden = false;
      }
    } finally {
      setBusy(false);
      $('request').disabled = !currentUser || existing;
    }
  });

  $('request').addEventListener('click', async () => {
    if (busy || !currentUser || existing) return;
    if (!window.confirm(
      'Confirma o registro de solicitação de exclusão? A conta NÃO será apagada agora.'
    )) return;
    setBusy(true);
    try {
      await setDoc(userRequestRef(), {
        status: 'requested',
        source: 'web',
        requestedAt: serverTimestamp()
      });
      existing = true;
      message('Pedido registrado. Sua conta ainda está ativa até o processamento administrativo.');
    } catch (_) {
      // Em caso de repetição, a regra de segurança impede a sobrescrita.
      try { await fetchRequest(); } catch (_) {
        message('Não foi possível confirmar o pedido. Tente novamente mais tarde.');
      }
    } finally {
      setBusy(false);
    }
  });

  $('reset').addEventListener('click', async () => {
    if (busy) return;
    const email = $('email').value.trim();
    if (!email || email.length > 150) {
      message('Informe seu e-mail para solicitar a redefinição de senha.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (_) {
      // Não revelar a existência de contas a terceiros.
    } finally {
      message('Se houver conta para este e-mail, siga as instruções de recuperação recebidas.');
      setBusy(false);
    }
  });

  $('logout').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try { await signOut(auth); } finally {
      currentUser = null;
      existing = false;
      accountPanel.hidden = true;
      $('login-form').hidden = false;
      $('reset').hidden = false;
      $('password').value = '';
      message('Sessão encerrada. Nenhum dado de acesso foi salvo neste navegador.');
      setBusy(false);
    }
  });

  window.addEventListener('pagehide', () => {
    // Sessão é em memória, sem armazenamento persistente.
    void signOut(auth).catch(() => {});
  });
}
