/**
 * Portao de e-mail dos Workers do Atrio Catolico.
 *
 * Identity Toolkit valida previamente o ID token da conta. Se o email ainda
 * nao estiver verificado, a consulta administrativa da politica utiliza um
 * token OAuth de SERVICE ACCOUNT ja disponivel no Worker; a resposta nao
 * depende de claims editaveis, parametros do request ou caches locais.
 * Em caso de erro, a operacao comunitaria permanece bloqueada.
 */
export const EMAIL_VERIFICATION_POLICY_URL =
  'https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/app_config/email_verification';
const POLICY_VERSION='2026-11-v1';

function policyUnavailable(qaCode){
  // Codigo limitado para diagnostico de QA. NUNCA contem resposta remota,
  // identificador de usuario, OAuth, secrets ou mensagem livre da excecao.
  const err=Error('email_policy_unavailable');
  Object.defineProperty(err,'qaCode',{value:qaCode});
  return err;
}

/**
 * @param {string} policyAccessToken OAuth de servico, nunca token do cliente.
 * @param {boolean} emailVerified Campo emailVerified autenticado pelo Identity Toolkit.
 * @param {Function} fetcher Apenas injecao de testes. No Worker usa fetch nativo.
 * @returns {Promise<boolean>} true se a operacao comunitaria pode continuar.
 */
export async function emailAllowsCommunity(policyAccessToken,emailVerified,fetcher=fetch) {
  // Um retorno autentico da conta verificada pode prosseguir sem nova consulta.
  if(emailVerified===true) return true;
  if(typeof policyAccessToken!=='string'||policyAccessToken.length<20||policyAccessToken.length>12000)
    throw Error('invalid_identity');
  let res;
  try {
    res=await fetcher(EMAIL_VERIFICATION_POLICY_URL,{
      method:'GET',
      headers:{Authorization:'Bearer '+policyAccessToken},
      // Workers nao implementa redirect:'error': usa manual e rejeita 3xx.
      redirect:'manual',
      cache:'no-store',
      signal:AbortSignal.timeout(7000)
    });
  }catch(error){
    const msg=typeof error?.message==='string'?error.message:'';
    const reason=error?.name==='TimeoutError'?'policy_timeout':
      /cache.*(?:not implemented|unsupported)/i.test(msg)?'policy_fetch_runtime_cache':
      'policy_fetch_failed';
    throw policyUnavailable(reason);
  }
  // Documento ausente = politica ainda nao ativada. HTTP 401/403/5xx nao
  // equivalem a flag desligada, para evitar liberar em falhas do Firebase.
  if(res.status===404) return true;
  if(!res.ok) throw policyUnavailable([401,403,429,500,502,503,504].includes(res.status)
    ?'policy_http_'+res.status:'policy_http_other');
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
  }catch{throw policyUnavailable('policy_invalid_response');}
  return !(fields.enabled?.booleanValue===true &&
    fields.version?.stringValue===POLICY_VERSION);
}
