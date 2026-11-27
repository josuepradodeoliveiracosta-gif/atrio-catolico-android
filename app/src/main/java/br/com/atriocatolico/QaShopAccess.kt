package br.com.atriocatolico

/** A loja remota permanece um laboratório simulado, nunca uma loja de produção. */
internal object QaShopAccess {
    fun allowed(
        buildType: String,
        remote: Boolean,
        functional: Boolean,
        projectId: String?,
        confirmed: Boolean,
        enabled: Boolean,
    ): Boolean = buildType == "qaGeral" && remote && functional &&
        projectId == "atrio-catolico-qa-general" && confirmed && enabled
}
