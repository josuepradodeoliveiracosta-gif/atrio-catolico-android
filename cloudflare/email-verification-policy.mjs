/**
 * Portao de e-mail dos Workers do Atrio Catolico.
 *
 * Identity Toolkit autentica previamente o token; consultamos a politica com
 * ESSE MESMO token Firebase, sem Service Account, porque Firestore Rules
 * permite somente get autenticado de app_config/email_verification.
 * Sem depender de flags em perfil, parametros do request ou caches locais.
 */
export const EMAIL_VERIFICATION_POLICY_URL =
  'https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/app_config/email_verification';
const POLICY_VERSION='2026-11-v1';

/**
 * @param {string} idToken ID token validado pelo Identity Toolkit antes da chamada.
 * @param {boolean} emailVerified Campo emailVerified devolvido pelo Identity Toolkit.
 * @param {Function} fetcher Apenas injecao de testes. No Worker usa fetch nativo.
 * @returns {Promise<boolean>} true se a operacao comunitaria pode continuar.
 */
export async function emailAllowsCommunity(idToken,emailVerified,fetcher=fetch) {
  // Um retorno autentico da conta verificada pode prosseguir sem nova consulta.
  if(emailVerified===true) return true;
  if(typeof idToken!=='string'||idToken.length<100||idToken.length>5000)
    throw Error('invalid_identity');
  let res;
  try {
    res=await fetcher(EMAIL_VERIFICATION_POLICY_URL,{
      method:'GET',
      headers:{Authorization:'Bearer '+idToken},
      redirect:'error',
      cache:'no-store',
      signal:AbortSignal.timeout(7000)
    });
  }catch{
    throw Error('email_policy_unavailable');
  }
  // Documento ausente = politica ainda nao ativada. HTTP 401/403/5xx nao
  // equivalem a flag desligada, para evitar liberar em falhas do Firebase.
  if(res.status===404) return true;
  if(!res.ok) throw Error('email_policy_unavailable');
  let fields;
  try {
    const data=await res.json();
    fields=data?.fields;
    if(!fields||typeof fields!=='object'||Array.isArray(fields))
      throw Error('invalid_email_policy');
    if(fields.enabled?.booleanValue!==undefined &&
       typeof fields.enabled.booleanValue!=='boolean')
      throw Error('invalid_email_policy');
    if(fields.version?.stringValue!==undefined &&
       typeof fields.version.stringValue!=='string')
      throw Error('invalid_email_policy');
  }catch{throw Error('email_policy_unavailable');}
  return !(fields.enabled?.booleanValue===true &&
    fields.version?.stringValue===POLICY_VERSION);
}
