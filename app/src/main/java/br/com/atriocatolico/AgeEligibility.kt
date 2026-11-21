package br.com.atriocatolico

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import com.google.firebase.functions.FirebaseFunctions
import java.time.LocalDate
import java.time.Period
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.ResolverStyle
import java.util.Locale

internal enum class AgeEligibilityAccess {
    CHECKING,
    REQUIRED,
    SUBMITTING,
    ELIGIBLE,
    INELIGIBLE,
    UNAVAILABLE,
}

internal enum class AgeEligibilityDecision {
    INVALID_DATE,
    CONFIRMATION_REQUIRED,
    UNDER_18,
    ELIGIBLE,
}

internal object AgeEligibilityPolicy {
    const val VERSION = "2026-11-18plus-v1"
    const val MINIMUM_AGE = 18
    const val METHOD = "local_birthdate_self_declaration"
    private const val ELIGIBLE = "eligible"
    private const val INELIGIBLE = "ineligible"
    private val birthDateFormatter = DateTimeFormatter.ofPattern("dd/MM/uuuu", Locale.ROOT)
        .withResolverStyle(ResolverStyle.STRICT)

    fun formatBirthDateInput(value: String): String {
        val digits = value.filter(Char::isDigit).take(8)
        return when {
            digits.length <= 2 -> digits
            digits.length <= 4 -> "${digits.take(2)}/${digits.drop(2)}"
            else -> "${digits.take(2)}/${digits.substring(2, 4)}/${digits.drop(4)}"
        }
    }

    fun parseBirthDate(value: String): LocalDate? = try {
        LocalDate.parse(value, birthDateFormatter)
    } catch (_: DateTimeParseException) {
        null
    }

    fun decision(
        value: String,
        confirmed18Plus: Boolean,
        today: LocalDate,
    ): AgeEligibilityDecision {
        val birthDate = parseBirthDate(value) ?: return AgeEligibilityDecision.INVALID_DATE
        if (birthDate.isAfter(today)) return AgeEligibilityDecision.INVALID_DATE
        if (Period.between(birthDate, today).years < MINIMUM_AGE) {
            return AgeEligibilityDecision.UNDER_18
        }
        return if (confirmed18Plus) AgeEligibilityDecision.ELIGIBLE
        else AgeEligibilityDecision.CONFIRMATION_REQUIRED
    }

    fun isEligibleProof(snapshot: DocumentSnapshot): Boolean =
        snapshot.exists() &&
            snapshot.getString("status") == ELIGIBLE &&
            snapshot.getLong("minimumAge") == MINIMUM_AGE.toLong() &&
            snapshot.getString("policyVersion") == VERSION &&
            snapshot.getString("method") == METHOD &&
            snapshot.getTimestamp("attestedAt") != null

    fun isIneligibleProof(snapshot: DocumentSnapshot): Boolean =
        snapshot.exists() &&
            snapshot.getString("status") == INELIGIBLE &&
            snapshot.getLong("minimumAge") == MINIMUM_AGE.toLong() &&
            snapshot.getString("policyVersion") == VERSION

    fun expectedStatus(isEligible: Boolean): String = if (isEligible) ELIGIBLE else INELIGIBLE
}

internal object AgeEligibilityRepository {
    fun read(db: FirebaseFirestore, uid: String, onResult: (AgeEligibilityAccess) -> Unit) {
        db.document("users/$uid/private/age_eligibility")
            .get(Source.SERVER)
            .addOnCompleteListener { task ->
                onResult(
                    when {
                        !task.isSuccessful -> AgeEligibilityAccess.UNAVAILABLE
                        task.result?.let(AgeEligibilityPolicy::isEligibleProof) == true ->
                            AgeEligibilityAccess.ELIGIBLE
                        task.result?.let(AgeEligibilityPolicy::isIneligibleProof) == true ->
                            AgeEligibilityAccess.INELIGIBLE
                        else -> AgeEligibilityAccess.REQUIRED
                    }
                )
            }
    }

    fun attest(
        functions: FirebaseFunctions,
        isEligible: Boolean,
        onResult: (AgeEligibilityAccess) -> Unit,
    ) {
        functions.getHttpsCallable("recordAgeEligibility")
            .call(mapOf(
                "attests18Plus" to isEligible,
                "policyVersion" to AgeEligibilityPolicy.VERSION,
            ))
            .addOnCompleteListener { task ->
                val result = if (task.isSuccessful) task.result?.data as? Map<*, *> else null
                val validResponse = task.isSuccessful &&
                    result != null &&
                    result["status"] == AgeEligibilityPolicy.expectedStatus(isEligible) &&
                    (result["minimumAge"] as? Number)?.toInt() == AgeEligibilityPolicy.MINIMUM_AGE &&
                    result["policyVersion"] == AgeEligibilityPolicy.VERSION
                onResult(
                    if (!validResponse) AgeEligibilityAccess.UNAVAILABLE
                    else if (isEligible) AgeEligibilityAccess.ELIGIBLE
                    else AgeEligibilityAccess.INELIGIBLE
                )
            }
    }
}

@Composable
internal fun AgeEligibilityScreen(
    onSubmit: (isEligible: Boolean) -> Unit,
) {
    var birthDate by remember { mutableStateOf("") }
    var confirmed18Plus by remember { mutableStateOf(false) }
    val decision = AgeEligibilityPolicy.decision(
        value = birthDate,
        confirmed18Plus = confirmed18Plus,
        today = LocalDate.now(),
    )
    val canSubmit = decision == AgeEligibilityDecision.ELIGIBLE ||
        decision == AgeEligibilityDecision.UNDER_18

    Column(
        Modifier.fillMaxSize().background(Paper).verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp)
            .testTag("atrio-age-eligibility"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        Spacer(Modifier.height(12.dp))
        Text("Átrio Católico", fontFamily = FontFamily.Serif,
            color = Wine, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text("Acesso para maiores de 18 anos", color = Wine,
            style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
            "O Átrio é destinado a pessoas com 18 anos ou mais. Informe sua data de nascimento " +
                "para que a idade seja calculada neste aparelho; a data não é enviada nem salva. " +
                "A autodeclaração não é uma verificação independente.",
            color = Ink, style = MaterialTheme.typography.bodyLarge,
        )
        OutlinedTextField(
            value = birthDate,
            onValueChange = { birthDate = AgeEligibilityPolicy.formatBirthDateInput(it) },
            modifier = Modifier.fillMaxWidth().testTag("atrio-age-birth-date"),
            label = { Text("Data de nascimento") },
            placeholder = { Text("DD/MM/AAAA") },
            supportingText = {
                Text(
                    if (birthDate.isBlank()) "Formato DD/MM/AAAA; cálculo somente neste aparelho."
                    else when (decision) {
                        AgeEligibilityDecision.INVALID_DATE -> "Informe uma data válida."
                        AgeEligibilityDecision.CONFIRMATION_REQUIRED ->
                            "Marque a confirmação de maioridade para continuar."
                        AgeEligibilityDecision.UNDER_18 ->
                            "A idade informada não atende ao limite mínimo de 18 anos."
                        AgeEligibilityDecision.ELIGIBLE ->
                            "A data informada atende ao limite de 18 anos."
                    }
                )
            },
            isError = birthDate.isNotBlank() && (decision == AgeEligibilityDecision.INVALID_DATE ||
                decision == AgeEligibilityDecision.UNDER_18),
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Number,
                imeAction = ImeAction.Done,
            ),
        )
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = confirmed18Plus,
                onCheckedChange = { confirmed18Plus = it },
                modifier = Modifier.testTag("atrio-age-confirmation"),
            )
            Text(
                "Confirmo que tenho 18 anos ou mais.",
                modifier = Modifier.padding(start = 8.dp),
                color = Ink,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Button(
            onClick = {
                val eligible = decision == AgeEligibilityDecision.ELIGIBLE
                // A data permanece apenas na memória desta tela e não segue para Firebase.
                birthDate = ""
                confirmed18Plus = false
                onSubmit(eligible)
            },
            enabled = canSubmit,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("atrio-age-continue"),
            colors = ButtonDefaults.buttonColors(containerColor = Wine),
        ) { Text("Continuar") }
    }
}

@Composable
internal fun AgeEligibilityStatusScreen(
    state: AgeEligibilityAccess,
    onRetry: () -> Unit,
    onReviewAge: () -> Unit,
    onSignOut: (() -> Unit)? = null,
) {
    Column(
        Modifier.fillMaxSize().background(Paper).verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp)
            .testTag("atrio-age-status"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Text("Átrio Católico", fontFamily = FontFamily.Serif,
            color = Wine, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        when (state) {
            AgeEligibilityAccess.CHECKING, AgeEligibilityAccess.SUBMITTING -> {
                CircularProgressIndicator(color = Wine)
                Text(
                    if (state == AgeEligibilityAccess.CHECKING) "Consultando a elegibilidade…"
                    else "Salvando somente a declaração de idade…",
                    color = Ink,
                )
            }
            AgeEligibilityAccess.INELIGIBLE -> {
                Text("Acesso não liberado", color = Wine,
                    style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "O Átrio exige idade mínima de 18 anos. A data de nascimento não foi salva. " +
                        "Se houve erro ao informar a data, você pode revisar a declaração.",
                    color = Ink, style = MaterialTheme.typography.bodyLarge,
                )
                Button(
                    onClick = onReviewAge,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .testTag("atrio-age-review"),
                    colors = ButtonDefaults.buttonColors(containerColor = Wine),
                ) { Text("Revisar idade") }
                if (onSignOut != null) {
                    OutlinedButton(
                        onClick = onSignOut,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("atrio-age-sign-out"),
                    ) { Text("Sair") }
                }
            }
            AgeEligibilityAccess.UNAVAILABLE -> {
                Text("Não foi possível confirmar a elegibilidade", color = Wine,
                    style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "Sem resposta do Firebase, o acesso permanece bloqueado. Confira a conexão e tente novamente.",
                    color = Ink, style = MaterialTheme.typography.bodyLarge,
                )
                Button(
                    onClick = onRetry,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .testTag("atrio-age-retry"),
                    colors = ButtonDefaults.buttonColors(containerColor = Wine),
                ) { Text("Tentar novamente") }
                if (onSignOut != null) {
                    OutlinedButton(
                        onClick = onSignOut,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("atrio-age-sign-out"),
                    ) { Text("Sair") }
                }
            }
            AgeEligibilityAccess.REQUIRED -> Text(
                "É necessário confirmar a idade para continuar.",
                color = Ink, style = MaterialTheme.typography.bodyLarge,
            )
            AgeEligibilityAccess.ELIGIBLE -> Unit
        }
    }
}
