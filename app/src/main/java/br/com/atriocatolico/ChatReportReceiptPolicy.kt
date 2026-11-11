package br.com.atriocatolico

/**
 * Apenas reconhece protocolo previamente existente, lido do SERVIDOR
 * no caminho exato do próprio usuário. Não concede autorização:
 * a verificação de acesso continua exclusiva das Firestore Rules.
 */
internal object ChatReportReceiptPolicy {
    fun matchesConfirmedOwnReport(
        fromCache: Boolean,
        pendingWrites: Boolean,
        reporterUid: String?,
        expectedReporterUid: String,
        conversationId: String?,
        expectedConversationId: String,
        messageId: String?,
        expectedMessageId: String
    ): Boolean = !fromCache && !pendingWrites &&
        expectedReporterUid.isNotBlank() &&
        expectedConversationId.isNotBlank() &&
        expectedMessageId.isNotBlank() &&
        reporterUid == expectedReporterUid &&
        conversationId == expectedConversationId &&
        messageId == expectedMessageId
}
