package br.com.atriocatolico

/**
 * Validação local para NOVAS contas. O login de usuários existentes não aplica
 * esta política retroativamente. A regra de 15 caracteres também deve ser
 * exigida pelo Firebase Authentication (Console > Política de senha).
 *
 * Esta lista pequena de exemplos óbvios não substitui verificação de vazamentos
 * por um serviço confiável, que não deve receber a senha em texto puro.
 */
internal object RegistrationPolicy {
    const val MIN_PASSWORD = 15
    const val MAX_PASSWORD = 128
    private val emailPattern = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$")
    private val common = setOf(
        "123456789012345", "1234567890123456", "passwordpassword",
        "senha1234567890", "123456789abcdef", "qwertyqwerty123",
        "adminadminadmin", "senha123456789012"
    )

    fun validName(name: String): Boolean = name.trim().length in 2..35
    fun validEmail(email: String): Boolean {
        val trimmed = email.trim()
        return trimmed.length <= 150 && emailPattern.matches(trimmed)
    }

    fun passwordProblem(password: String, email: String, name: String): String? {
        if (password.length < MIN_PASSWORD) return "Use pelo menos 15 caracteres."
        if (password.length > MAX_PASSWORD) return "Use até 128 caracteres."
        val lower = password.lowercase()
        if (lower in common) return "Essa senha é muito conhecida. Escolha outra."
        if (lower.all { it == lower.first() }) return "Evite repetir o mesmo caractere."
        val localPart = email.trim().substringBefore('@').lowercase()
        if (localPart.length >= 5 && lower.contains(localPart)) {
            return "Não inclua seu endereço de e-mail na senha."
        }
        val publicName = name.trim().lowercase()
        if (publicName.length >= 5 && lower == publicName) {
            return "Escolha uma senha diferente do nome público."
        }
        return null
    }

    fun confirmProblem(password: String, confirmation: String): String? =
        if (confirmation != password) "As senhas não coincidem." else null

    fun ready(name: String, email: String, password: String, confirmation: String, accepted: Boolean): Boolean =
        validName(name) && validEmail(email) &&
            passwordProblem(password, email, name) == null &&
            confirmProblem(password, confirmation) == null && accepted
}
