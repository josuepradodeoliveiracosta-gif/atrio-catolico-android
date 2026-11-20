// Fronteira de autenticação para o serviço administrativo QA; nunca exportar no APK.
// O endpoint que invocar execute() deve usar HTTPS, não aceitar proxy de identidade
// e injetar Firebase Admin Auth do projeto QA, com allowlist somente no servidor.
import {createConversationPushAdminService} from './conversation-push-admin.mjs';

const CAPABILITIES=new Set(['manage_admissions','publish_notices']);
const ACTIONS=Object.freeze({
  admit:'manage_admissions',
  revoke:'manage_admissions',
  publish:'publish_notices',
});
const uidValid=uid=>typeof uid==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);

export function createAuthenticatedConversationPushAdmin({
  db,auth,serverTimestamp,projectId,allowedOperators,identity,now,
}) {
  if (!auth || typeof auth.verifyIdToken!=='function' ||
      typeof projectId!=='string' || !/^atrio-catolico-qa-[a-z-]+$/.test(projectId) ||
      !allowedOperators || typeof allowedOperators!=='object' ||
      !Object.keys(allowedOperators).length)
    throw new Error('qa_operator_configuration_required');
  const allowed=new Map();
  for(const [uid,capabilities] of Object.entries(allowedOperators)) {
    if (!uidValid(uid) || !Array.isArray(capabilities) ||
        !capabilities.length || capabilities.some(c=>!CAPABILITIES.has(c)))
      throw new Error('invalid_operator_allowlist');
    allowed.set(uid,new Set(capabilities));
  }
  // Serviço privado: nenhum chamador externo recebe o Admin SDK ou uma
  // referência ao serviço com privilégios elevados.
  const service=createConversationPushAdminService({
    db,serverTimestamp,identity,now,
    authorize:(principal,capability)=>
      typeof principal==='string' && allowed.get(principal)?.has(capability)===true,
  });

  async function execute({authorization,action,payload}) {
    const capability=ACTIONS[action];
    if (!capability || !payload || typeof payload!=='object' ||
        Array.isArray(payload)) throw new Error('invalid_admin_request');
    if (typeof authorization!=='string' ||
        !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization))
      throw new Error('operator_unauthenticated');
    let token;
    try {
      // checkRevoked=true também rejeita conta desativada e sessão revogada.
      token=await auth.verifyIdToken(authorization.slice(7),true);
    } catch {
      throw new Error('operator_unauthenticated');
    }
    if (!uidValid(token?.uid) || token.aud!==projectId ||
        token.email_verified!==true ||
        token.firebase?.sign_in_provider==='anonymous')
      throw new Error('operator_unauthenticated');
    const claims=token.atrioQaPushCapabilities;
    if (!allowed.get(token.uid)?.has(capability) ||
        !Array.isArray(claims) || !claims.includes(capability))
      throw new Error('operator_forbidden');
    // Não permitir que o payload controle a identidade do operador.
    const {principal:_ignored,...data}=payload;
    return service[action]({...data,principal:token.uid});
  }
  return Object.freeze({execute});
}
