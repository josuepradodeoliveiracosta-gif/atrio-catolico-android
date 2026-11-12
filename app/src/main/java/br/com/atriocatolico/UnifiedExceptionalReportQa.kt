package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** Roteador apenas de interfaces existentes; nao concede permissoes de Firestore. */
internal enum class UnifiedReportSubjectQa { PARTICIPANT, DIRECT_MESSAGE, GROUP_MESSAGE }
internal enum class UnifiedReportAccessQa {
    MEMBER_WITH_CONTEXT, FORMER_MEMBER, SUSPENDED, NO_LOGIN, CHAT_UNAVAILABLE
}
internal enum class UnifiedReportFlowQa {
    EXISTING_USER_REPORT, EXISTING_CHAT_REPORT, EXISTING_GROUP_REPORT,
    EXCEPTIONAL_PENDING_APPROVAL
}
internal data class UnifiedReportDecisionQa(
    val flow: UnifiedReportFlowQa,
    val mayRouteToExistingUi: Boolean,
    val exceptionalIntakeActive: Boolean = false,
    val canIssueReceipt: Boolean = false,
    val canAccessPrivateHistory: Boolean = false,
    val canPersistExceptionalReport: Boolean = false,
    val rolloutApproved: Boolean = false
)
internal object UnifiedReportEntryQaPolicy {
    fun decide(
        subject: UnifiedReportSubjectQa,
        access: UnifiedReportAccessQa,
        sessionAuthenticated: Boolean,
        canAccessExistingContext: Boolean
    ): UnifiedReportDecisionQa {
        if (!sessionAuthenticated || !canAccessExistingContext ||
            access != UnifiedReportAccessQa.MEMBER_WITH_CONTEXT) {
            return UnifiedReportDecisionQa(
                UnifiedReportFlowQa.EXCEPTIONAL_PENDING_APPROVAL, false)
        }
        val existing = when (subject) {
            UnifiedReportSubjectQa.PARTICIPANT -> UnifiedReportFlowQa.EXISTING_USER_REPORT
            UnifiedReportSubjectQa.DIRECT_MESSAGE -> UnifiedReportFlowQa.EXISTING_CHAT_REPORT
            UnifiedReportSubjectQa.GROUP_MESSAGE -> UnifiedReportFlowQa.EXISTING_GROUP_REPORT
        }
        return UnifiedReportDecisionQa(existing, true)
    }
}

/**
 * SOMENTE Chat QA: tela informativa, sem campos, backend, envio ou recibos.
 * Nao e um canal real; acesso excepcional permanece desativado.
 */
@Composable
internal fun UnifiedExceptionalReportQaPreview(onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val decision = UnifiedReportEntryQaPolicy.decide(
        UnifiedReportSubjectQa.PARTICIPANT,
        UnifiedReportAccessQa.NO_LOGIN, false, false)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(24.dp).testTag("atrio-exceptional-qa-preview"),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Ajuda e denúncias", style = MaterialTheme.typography.headlineSmall)
        Text("Prévia de homologação. Este canal excepcional ainda NÃO recebe relatos.",
            style = MaterialTheme.typography.titleMedium)
        Text("O Átrio já possui denúncias de participantes, mensagens e grupos " +
            "para quem tem acesso aos respectivos recursos.")
        Text("A nova entrada será destinada a ex-integrantes, contas suspensas, " +
            "pessoas sem login ou com chat indisponível, após revisão de segurança.")
        if (decision.flow == UnifiedReportFlowQa.EXCEPTIONAL_PENDING_APPROVAL &&
            !decision.exceptionalIntakeActive && !decision.canIssueReceipt) {
            Text("Não envie informações por esta tela: não existe formulário, " +
                "nenhuma denúncia será recebida e nenhum protocolo será emitido.",
                modifier = Modifier.testTag("atrio-exceptional-qa-no-receipt"))
        }
        Text("Não há atendimento emergencial 24 horas habilitado por esta prévia.")
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()
            .testTag("atrio-exceptional-qa-back")) { Text("Voltar") }
    }
}
