package br.com.atriocatolico

import java.text.Normalizer
import java.util.Locale

/**
 * Alerta local e EDUCATIVO para o autor antes de publicar/editar.
 * Não concede privilégios, não armazena texto e NÃO substitui as Firestore Rules
 * nem o Guardião do servidor. Pode ser ignorado por um cliente modificado.
 */
internal object GuardianPreflight {
    internal data class Warning(val rule: String, val explanation: String)

    private val accentMarks = Regex("[\u0300-\u036f]")
    private val cpfPattern = Regex("""\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}\b""")
    private val urlPattern = Regex("""(?i)(?:https?://|www\.)\S+""")
    private val httpPattern = Regex("""(?i)https?://\S+""")
    private val credentials = Regex("""\b(senha|codigo de verificacao|token|pix|dados bancarios)\b""")
    private val requestWords = Regex("""\b(envie|mande|informe|clique|confirme|atualize)\b""")
    private val threat = Regex("""\b(vou|iremos)\s+(?:te\s+|lhe\s+|voce\s+)?(?:matar|agredir|machucar)\b""")
    private val contextualQuote = Regex(
        """\b(evangelho|biblia|catecismo|citacao|citando|relato|denuncio|ameacou|ameaca recebida)\b"""
    )

    internal fun inspect(content: String): Warning? {
        if (content.length > 4000) return Warning(
            "input_limit", "O texto é muito extenso para esta verificação. Revise antes de enviar."
        )
        val text = Normalizer.normalize(content, Normalizer.Form.NFD)
            .replace(accentMarks, "").lowercase(Locale.ROOT)
        val quotedOrReported = contextualQuote.containsMatchIn(text)
        if (cpfPattern.findAll(content).any { validCpf(it.value.filter(Char::isDigit)) }) {
            return Warning(
                "personal_data", "O texto pode conter um CPF. Evite publicar dados pessoais de terceiros."
            )
        }
        if (urlPattern.containsMatchIn(content) &&
            credentials.containsMatchIn(text) &&
            requestWords.containsMatchIn(text) && !quotedOrReported
        ) return Warning(
            "possible_phishing", "O texto parece pedir uma senha ou dados bancários por um link. Confira antes de publicar."
        )
        if (threat.containsMatchIn(text) && !quotedOrReported) return Warning(
            "possible_threat", "O texto pode soar como uma ameaça. Considere reformular antes de enviar."
        )
        if (httpPattern.findAll(content).count() >= 4) return Warning(
            "links_excessive", "O texto possui vários links. Confira se todos são necessários."
        )
        return null
    }

    private fun validCpf(digits: String): Boolean {
        if (digits.length != 11 || digits.toSet().size == 1 || digits.any { !it.isDigit() }) return false
        fun digit(len: Int): Int {
            val sum = (0 until len).sumOf { i ->
                (digits[i] - '0') * (len + 1 - i)
            }
            return (sum * 10 % 11) % 10
        }
        return digit(9) == digits[9] - '0' && digit(10) == digits[10] - '0'
    }
}
