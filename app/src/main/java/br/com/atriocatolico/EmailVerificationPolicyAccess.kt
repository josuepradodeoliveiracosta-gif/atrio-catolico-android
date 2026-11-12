package br.com.atriocatolico

/**
 * A UI nunca presume que a verificacao e opcional antes de obter uma resposta
 * atual do servidor. Dados somente do cache e falhas de leitura nao liberam
 * uma conta cujo e-mail ainda nao foi verificado.
 */
internal enum class EmailVerificationPolicyAccess {
    CHECKING, REQUIRED, OPTIONAL, UNAVAILABLE
}

internal fun emailVerificationPolicyFromServer(
    enabled: Boolean?, version: String?
): EmailVerificationPolicyAccess =
    if (enabled == true && version == "2026-11-v1")
        EmailVerificationPolicyAccess.REQUIRED
    else EmailVerificationPolicyAccess.OPTIONAL

internal fun canEnterAtrioCommunity(
    emailVerified: Boolean, policy: EmailVerificationPolicyAccess
): Boolean = emailVerified || policy == EmailVerificationPolicyAccess.OPTIONAL

/**
 * Apenas a variante Chat QA exige política 2026-11-v1 ativa e publicada.
 * Se ausente/desativada/incompatível, a comunidade fica bloqueada na UI.
 * A autenticação e as Rules do Firebase ainda são autoridade final.
 */
internal fun qaEmailVerificationPolicyFromServer(
    enabled: Boolean?, version: String?
): EmailVerificationPolicyAccess =
    if (enabled == true && version == "2026-11-v1")
        EmailVerificationPolicyAccess.REQUIRED
    else EmailVerificationPolicyAccess.UNAVAILABLE

internal fun canEnterQaAtrioCommunity(
    emailVerified: Boolean, policy: EmailVerificationPolicyAccess
): Boolean = emailVerified && policy == EmailVerificationPolicyAccess.REQUIRED
