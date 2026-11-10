package br.com.atriocatolico

import java.time.LocalDate
import java.time.Period
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import java.util.Locale

/**
 * Pré-triagem LOCAL e VOLÁTIL para o cadastro Chat QA.
 * NÃO é comprovante de maioridade: nunca autoriza chat e nunca escreve
 * data de nascimento, elegibilidade ou identidade no Firebase.
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

    fun assess(dateText: String, today: LocalDate): Assessment {
        if (dateText.isBlank()) return Assessment.NOT_PROVIDED
        if (!Regex("[0-9]{2}/[0-9]{2}/[0-9]{4}").matches(dateText)) {
            return Assessment.INVALID_DATE
        }
        val birthday = try {
            LocalDate.parse(dateText, dateFormat)
        } catch (_: java.time.format.DateTimeParseException) {
            return Assessment.INVALID_DATE
        }
        if (birthday.isAfter(today)) return Assessment.INVALID_DATE
        // Cálculo conservador em 29/02; não substitui análise legal/servidor.
        return if (Period.between(birthday, today).years >= 18) {
            Assessment.DECLARED_18_PLUS
        } else Assessment.DECLARED_UNDER_18
    }
}
