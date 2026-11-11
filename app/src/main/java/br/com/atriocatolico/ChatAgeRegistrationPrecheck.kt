package br.com.atriocatolico

import java.time.LocalDate
import java.time.Period
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale

/**
 * Pré-triagem LOCAL e VOLÁTIL para o cadastro Chat QA.
 * NÃO é comprovante de maioridade. A data não é persistida nem enviada;
 * apenas um sinal de autodeclaração pode ser solicitado na variante QA.
 */
internal object ChatAgeRegistrationPrecheck {
    enum class Assessment {
        NOT_PROVIDED, INVALID_DATE, DECLARED_UNDER_18, DECLARED_18_PLUS
    }

    private val dateFormat = DateTimeFormatter.ofPattern("dd/MM/uuuu", Locale.ROOT)
        .withResolverStyle(ResolverStyle.STRICT)

    fun formatInput(value: String): String {
        val digits = value.filter { it in '0'..'9' }.take(8)
        return buildString {
            append(digits.take(2))
            if (digits.length > 2) append('/').append(digits.substring(2, minOf(4, digits.length)))
            if (digits.length > 4) append('/').append(digits.substring(4))
        }
    }

    /** Idade calculada exclusivamente da data declarada, não verificada. */
    fun declaredAge(dateText: String, today: LocalDate): Int? {
        if (!Regex("[0-9]{2}/[0-9]{2}/[0-9]{4}").matches(dateText)) return null
        val birthday = try {
            LocalDate.parse(dateText, dateFormat)
        } catch (_: java.time.format.DateTimeParseException) {
            return null
        }
        if (birthday.isAfter(today)) return null
        // Regra conservadora para quem nasceu em 29/02.
        return Period.between(birthday, today).years
    }

    fun assess(dateText: String, today: LocalDate): Assessment {
        if (dateText.isBlank()) return Assessment.NOT_PROVIDED
        val years = declaredAge(dateText, today) ?: return Assessment.INVALID_DATE
        return if (years >= 18) Assessment.DECLARED_18_PLUS
            else Assessment.DECLARED_UNDER_18
    }

    /** A seleção anterior do checkbox não libera uma data alterada. */
    fun canRequestChatAccess(dateText: String, confirmed: Boolean, today: LocalDate): Boolean =
        confirmed && assess(dateText, today) == Assessment.DECLARED_18_PLUS
}
