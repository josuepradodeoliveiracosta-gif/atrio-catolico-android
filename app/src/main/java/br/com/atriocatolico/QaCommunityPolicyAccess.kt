package br.com.atriocatolico

/**
 * Gate extra somente para a variante br.com.atriocatolico.chatqa.
 * NUNCA confiar em cache, erro ou politica ausente como aceite valido.
 * Firestore Rules continuam autoridade final de acesso.
 */
internal enum class QaCommunityPolicyAccess {
    REQUIRED, UNAVAILABLE
}

internal fun qaCommunityPolicyFromServer(
    enabled: Boolean?,
    version: String?,
    fromCache: Boolean,
    hasError: Boolean
): QaCommunityPolicyAccess =
    if (!hasError && !fromCache &&
        enabled == true && version == CommunityRulesPolicy.VERSION
    ) QaCommunityPolicyAccess.REQUIRED
    else QaCommunityPolicyAccess.UNAVAILABLE
