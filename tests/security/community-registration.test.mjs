/**
 * Seguranca de aceite, bloqueio e denuncia de participantes.
 * Executado apenas no emulador Firestore, sem alterar producao.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc, serverTimestamp} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {host: '127.0.0.1', port: 8089, rules: readFileSync('firestore.rules', 'utf8')}
});
const alice = env.authenticatedContext('alice').firestore();
const bob = env.authenticatedContext('bob').firestore();
const admin = env.authenticatedContext('admin').firestore();
const anon = env.unauthenticatedContext().firestore();
const consent = uid => doc(alice, 'community_consents/' + uid);
const accepted = () => ({version:'2026-11-v1', acceptedAt:serverTimestamp()});
const blocked = uid => doc(alice,'users/alice/blockedMembers/' + uid);
const reportPath = 'user_reports/alice__bob';
const reported = () => ({
  reporterUid:'alice',targetUid:'bob',reason:'Assedio persistente nas discussoes',
  createdAt:serverTimestamp()
});
let count = 0;
async function check(name, action) {
  await action();
  ++count;
  console.log('PASS REGISTRATION SECURITY',name);
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(),'admins/admin'),{enabled:true});
    await setDoc(doc(context.firestore(),'app_config/community_rules'),{
      enabled:true,version:'2026-11-v1'
    });
  });
  await check('configuracao so pode ser lida por membro autenticado', () =>
    assertSucceeds(getDoc(doc(bob,'app_config/community_rules'))));
  await check('anonimo nao consulta portao de regras', () =>
    assertFails(getDoc(doc(anon,'app_config/community_rules'))));
  await check('usuario nao ativa ou muda regras globais', () =>
    assertFails(updateDoc(doc(bob,'app_config/community_rules'),{enabled:false})));

  await check('titular registra aceite versionado', () =>
    assertSucceeds(setDoc(consent('alice'),accepted())));
  await check('terceiro nao registra aceite alheio', () =>
    assertFails(setDoc(doc(bob,'community_consents/alice'),accepted())));
  await check('titular nao sobrescreve mesmo aceite', () =>
    assertFails(setDoc(consent('alice'),accepted())));
  await check('titular nao inventa versao futura', () =>
    assertFails(setDoc(doc(bob,'community_consents/bob'),{
      version:'2027-01-v0', acceptedAt:serverTimestamp()
    })));
  await check('titular nao injeta privilegios no aceite', () =>
    assertFails(setDoc(doc(bob,'community_consents/bob'),{
      ...accepted(),isAdmin:true
    })));
  await check('titular consulta proprio aceite', async () => {
    const d = await assertSucceeds(getDoc(consent('alice')));
    assert.equal(d.data().version,'2026-11-v1');
  });
  await check('aceites alheios nao sao visiveis', () =>
    assertFails(getDoc(doc(bob,'community_consents/alice'))));
  await check('aceites nao sao enumeraveis', () =>
    assertFails(getDocs(collection(bob,'community_consents'))));
  await check('aceite nao pode ser apagado pelo cliente', () =>
    assertFails(deleteDoc(consent('alice'))));

  await check('titular bloqueia outro membro', () =>
    assertSucceeds(setDoc(blocked('bob'),{createdAt:serverTimestamp()})));
  await check('titular consulta propria lista de bloqueios', async () => {
    const rows = await assertSucceeds(getDocs(collection(alice,'users/alice/blockedMembers')));
    assert.equal(rows.size,1);
  });
  await check('terceiro nao le bloqueios privados', () =>
    assertFails(getDocs(collection(bob,'users/alice/blockedMembers'))));
  await check('usuario nao bloqueia em nome de terceiro', () =>
    assertFails(setDoc(doc(bob,'users/alice/blockedMembers/admin'),{
      createdAt:serverTimestamp()
    })));
  await check('autobloqueio e proibido', () =>
    assertFails(setDoc(blocked('alice'),{createdAt:serverTimestamp()})));
  await check('bloqueio nao recebe campos extras', () =>
    assertFails(setDoc(blocked('admin'),{createdAt:serverTimestamp(),isAdmin:true})));
  await check('titular pode desbloquear', () =>
    assertSucceeds(deleteDoc(blocked('bob'))));

  await check('denuncia de usuario com motivo valido e aceita', () =>
    assertSucceeds(setDoc(doc(alice,reportPath),reported())));
  await check('denuncia duplicada nao pode sobrescrever motivo', () =>
    assertFails(setDoc(doc(alice,reportPath),reported())));
  await check('denunciante consulta denuncia propria', () =>
    assertSucceeds(getDoc(doc(alice,reportPath))));
  await check('denunciado nao consulta a denuncia', () =>
    assertFails(getDoc(doc(bob,reportPath))));
  await check('denuncias nao podem ser listadas por membros', () =>
    assertFails(getDocs(collection(alice,'user_reports'))));
  await check('administrador pode listar denuncias', () =>
    assertSucceeds(getDocs(collection(admin,'user_reports'))));
  await check('ID de denuncia deve corresponder ao par', () =>
    assertFails(setDoc(doc(bob,'user_reports/aleatorio'),{
      reporterUid:'bob',targetUid:'alice',reason:'Motivo de teste com contexto',
      createdAt:serverTimestamp()
    })));
  await check('membro nao marca denuncia como analisada', () =>
    assertFails(updateDoc(doc(alice,reportPath),{status:'reviewed'})));
  await check('admin nao pode forjar revisao de outra pessoa', () =>
    assertFails(updateDoc(doc(admin,reportPath),{
      status:'reviewed',reviewedBy:'alice',reviewedAt:serverTimestamp()
    })));
  await check('admin pode registrar revisao com hora do servidor', () =>
    assertSucceeds(updateDoc(doc(admin,reportPath),{
      status:'reviewed',reviewedBy:'admin',reviewedAt:serverTimestamp()
    })));
  await check('revisao e imutavel', () =>
    assertFails(updateDoc(doc(admin,reportPath),{status:'pending'})));
  console.log('OK: '+count+' verificacoes de cadastro e moderacao.');
} finally {
  await env.cleanup();
}
