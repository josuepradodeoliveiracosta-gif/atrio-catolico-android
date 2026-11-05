package br.com.atriocatolico

/**
 * Mensagens seguras para reenvio da confirmacao de e-mail.
 *
 * O Firebase confirmar o pedido NAO significa que a mensagem foi entregue
 * pelo provedor do destinatario. Nao exibir mensagens de excecao cruas,
 * credenciais ou enderecos completos no diagnostico.
 */
internal object EmailVerificationDeliveryFeedback {
    fun maskedAddress(email: String?): String {
        val address = email?.trim().orEmpty()
        val at = address.indexOf('@')
        if (at < 1 || at != address.lastIndexOf('@') || at == address.lastIndex) {
            return "endereço cadastrado"
        }
        val local = address.substring(0, at)
        val domain = address.substring(at + 1)
        if (domain.isBlank() || !domain.contains('.')) return "endereço cadastrado"
        return local.take(1) + "***@" + domain
    }

    fun accepted(): String =
        "O Firebase aceitou o pedido de confirmação, mas a entrega ainda não está comprovada. " +
            "Confira a caixa de entrada, Spam e Promoções. Se não chegar, verifique o endereço cadastrado."

    fun failed(errorCode: String?, networkFailure: Boolean = false): String =
        when {
            networkFailure || errorCode == "ERROR_NETWORK_REQUEST_FAILED" ->
                "Não foi possível solicitar o e-mail por falha de conexão. Confira a internet e tente novamente."
            errorCode == "ERROR_TOO_MANY_REQUESTS" ||
                errorCode == "ERROR_QUOTA_EXCEEDED" ->
                "Limite de tentativas de envio atingido pelo Firebase. Evite novos pedidos seguidos e tente mais tarde."
            errorCode == "ERROR_INVALID_USER_TOKEN" ||
                errorCode == "ERROR_USER_TOKEN_EXPIRED" ||
                errorCode == "ERROR_USER_DISABLED" ->
                "Sua sessão não está válida para reenviar. Saia da conta e entre novamente."
            errorCode == "ERROR_OPERATION_NOT_ALLOWED" ->
                "O envio de verificação está indisponível na configuração do Firebase. Informe o suporte."
            else ->
                "O Firebase não confirmou o pedido de envio. Confira a conexão e tente novamente mais tarde."
        }
}
