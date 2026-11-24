package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import java.io.ByteArrayOutputStream
import java.net.URL
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Somente os estágios e os três endpoints definidos pelo Chat 2 na #450. */
internal sealed interface ScopedWorkflowReply {
    data class Stage(val stage: String) : ScopedWorkflowReply
    data object Unavailable : ScopedWorkflowReply
    data object Closed : ScopedWorkflowReply
    data object Error : ScopedWorkflowReply
}
internal interface ScopedCaseWorkflowGateway {
    suspend fun state(uid: String, channel: String, caseId: String): ScopedWorkflowReply
    suspend fun action(uid: String, channel: String, caseId: String,
                       action: String, decision: String? = null, note: String? = null): ScopedWorkflowReply
    suspend fun appeal(uid: String, channel: String, caseId: String, reason: String): ScopedWorkflowReply
}
internal fun validScopedWorkflowNote(v: String) = v == v.trim() && v.length in 5..300
private val scopedWorkflowStages = setOf("open", "triaged", "decided", "appealed", "appeal_reviewed")

internal fun decodeScopedWorkflowReply(body: String, route: String, action: String? = null): ScopedWorkflowReply =
    try {
        val json = JSONObject(body)
        if (json.keys().asSequence().toSet() != setOf("status", "stage"))
            ScopedWorkflowReply.Error
        else {
            val stage = json.getString("stage")
            val status = if (route == "state") "available" else "accepted"
            val expected = when (route) {
                "state" -> stage
                "appeal" -> "appealed"
                "action" -> when (action) {
                    "triage" -> "triaged"
                    "decide" -> "decided"
                    "review_appeal" -> "appeal_reviewed"
                    else -> ""
                }
                else -> ""
            }
            if (json.getString("status") == status && stage in scopedWorkflowStages &&
                stage == expected) ScopedWorkflowReply.Stage(stage)
            else ScopedWorkflowReply.Error
        }
    } catch (_: Exception) { ScopedWorkflowReply.Error }

/** QA LOCAL opt-in. Nenhuma URL remota, redirect, cache ou recurso administrativo. */
internal class QaScopedCaseWorkflowHttpGateway(private val origin: String): ScopedCaseWorkflowGateway {
    override suspend fun state(uid: String, channel: String, caseId: String) =
        post(uid,channel,caseId,"state",null,null,null)
    override suspend fun action(uid: String, channel: String, caseId: String,
                                action: String, decision: String?, note: String?): ScopedWorkflowReply {
        if (action !in setOf("triage","decide","review_appeal")) return ScopedWorkflowReply.Error
        if (action == "triage" && (decision != null || note != null)) return ScopedWorkflowReply.Error
        if (action == "decide" && (decision !in setOf("dismissed","action_recommended") ||
                note == null || !validScopedWorkflowNote(note))) return ScopedWorkflowReply.Error
        if (action == "review_appeal" && (decision !in setOf("upheld","revised") ||
                note == null || !validScopedWorkflowNote(note))) return ScopedWorkflowReply.Error
        return post(uid,channel,caseId,"action",action,decision,note)
    }
    override suspend fun appeal(uid: String, channel: String, caseId: String, reason: String): ScopedWorkflowReply {
        if (!validScopedWorkflowNote(reason)) return ScopedWorkflowReply.Error
        return post(uid,channel,caseId,"appeal",null,null,reason)
    }
    private suspend fun post(uid:String,channel:String,caseId:String,route:String,
                             action:String?,decision:String?,note:String?):ScopedWorkflowReply =
        withContext(Dispatchers.IO) {
            if (!BuildConfig.ATRIO_QA_GERAL_CELULAR_PILOT || BuildConfig.ATRIO_QA_GERAL_REMOTE ||
                origin != "https://127.0.0.1:8095") return@withContext ScopedWorkflowReply.Closed
            if (channel !in setOf("direct","group") || !validScopedCaseId(caseId) ||
                route !in setOf("state","action","appeal")) return@withContext ScopedWorkflowReply.Error
            val auth = FirebaseAuth.getInstance()
            val account = auth.currentUser?.takeIf { it.uid == uid }
                ?: return@withContext ScopedWorkflowReply.Unavailable
            try {
                val token=Tasks.await(account.getIdToken(true),8,TimeUnit.SECONDS).token
                    ?.takeIf { it.isNotBlank() } ?: return@withContext ScopedWorkflowReply.Unavailable
                if (auth.currentUser?.uid != uid) return@withContext ScopedWorkflowReply.Unavailable
                val conn=URL(origin+"/v1/qa/conversations/moderation/case/"+route)
                    .openConnection() as HttpsURLConnection
                try {
                    conn.requestMethod="POST"; conn.instanceFollowRedirects=false; conn.useCaches=false
                    conn.connectTimeout=4000; conn.readTimeout=4000; conn.doOutput=true
                    conn.setRequestProperty("Content-Type","application/json")
                    conn.setRequestProperty("Accept","application/json")
                    conn.setRequestProperty("Cache-Control","no-store")
                    conn.setRequestProperty("Authorization","Bearer "+token)
                    val body=JSONObject().put("channel",channel).put("caseId",caseId)
                    if (route == "action") {
                        body.put("action",action)
                        if(decision!=null)body.put("decision",decision)
                        if(note!=null)body.put("note",note)
                    } else if(route=="appeal")body.put("reason",note)
                    conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                    val response=when(conn.responseCode) {
                        200 -> {
                            if(!conn.contentType.orEmpty().lowercase().startsWith("application/json"))
                                ScopedWorkflowReply.Error
                            else {
                                val buf=ByteArrayOutputStream()
                                conn.inputStream.use { stream ->
                                    val chunk=ByteArray(512)
                                    while(true) {
                                        val count=stream.read(chunk)
                                        if(count<0)break
                                        buf.write(chunk,0,count)
                                        if(buf.size()>2048)return@withContext ScopedWorkflowReply.Error
                                    }
                                }
                                decodeScopedWorkflowReply(buf.toString("UTF-8"),route,action)
                            }
                        }
                        404 -> ScopedWorkflowReply.Unavailable
                        503 -> ScopedWorkflowReply.Closed
                        else -> ScopedWorkflowReply.Error
                    }
                    if(auth.currentUser?.uid==uid) response else ScopedWorkflowReply.Unavailable
                } finally { conn.disconnect() }
            } catch(c:CancellationException){throw c}
            catch(_:Exception){ScopedWorkflowReply.Error}
        }
}
internal fun scopedWorkflowStageLabel(stage:String)=when(stage){
    "open" -> "Aguardando triagem"
    "triaged" -> "Triagem registrada"
    "decided" -> "Decisão registrada; aguarda eventual recurso"
    "appealed" -> "Recurso pendente de outro moderador"
    "appeal_reviewed" -> "Recurso revisado"
    else -> "Indisponível"
}

@Composable
internal fun ScopedModerationWorkflowControls(
    uid:String,observedUid:String?,channel:String,caseId:String,
    gateway:ScopedCaseWorkflowGateway,onDenied:(ScopedWorkflowReply)->Unit
){
    var stage by remember(uid,channel,caseId){mutableStateOf<String?>(null)}
    var busy by remember(uid,channel,caseId){mutableStateOf(true)}
    var decision by remember(uid,channel,caseId){mutableStateOf("")}
    var note by remember(uid,channel,caseId){mutableStateOf("")}
    var confirm by remember(uid,channel,caseId){mutableStateOf<String?>(null)}
    var message by remember(uid,channel,caseId){mutableStateOf("")}
    val scope=rememberCoroutineScope()
    val currentUid=rememberUpdatedState(observedUid)
    val blocked=rememberUpdatedState(onDenied)

    LaunchedEffect(uid,observedUid,channel,caseId) {
        busy=true;stage=null;decision="";note="";confirm=null;message=""
        if(uid.isBlank() || uid!=observedUid)return@LaunchedEffect
        val reply=try{gateway.state(uid,channel,caseId)}
            catch(c:CancellationException){throw c}
            catch(_:Exception){ScopedWorkflowReply.Error}
        if(currentUid.value!=uid)return@LaunchedEffect
        busy=false
        if(reply is ScopedWorkflowReply.Stage)stage=reply.stage else blocked.value(reply)
    }
    if(uid!=observedUid)return
    Column(Modifier.fillMaxWidth().testTag("scoped-workflow-controls"),
        verticalArrangement=Arrangement.spacedBy(8.dp)){
        if(busy)Text("Confirmando estado e atribuição…",
            modifier=Modifier.testTag("scoped-workflow-loading"))
        if(stage!=null)Text(scopedWorkflowStageLabel(stage!!),
            modifier=Modifier.testTag("scoped-workflow-stage"))
        if(message.isNotBlank())Text(message,modifier=Modifier.testTag("scoped-workflow-status"))
        if(stage=="open" && !busy) Button(onClick={confirm="triage"},
            modifier=Modifier.testTag("scoped-workflow-triage")){Text("Registrar triagem")}
        if(stage in setOf("triaged","appealed") && !busy){
            val isDecision=stage=="triaged"
            val options=if(isDecision)listOf("dismissed" to "Encerrar sem ação",
                "action_recommended" to "Recomendar providência")
                else listOf("upheld" to "Manter decisão","revised" to "Rever decisão")
            Text(if(isDecision)"Decisão humana" else "Revisão por outro moderador",
                style=MaterialTheme.typography.titleSmall)
            for((value,label) in options) FilterChip(decision==value,{decision=value},
                label={Text(label)},modifier=Modifier.testTag("scoped-workflow-choice-"+value))
            OutlinedTextField(note,{note=it.take(300)},label={Text("Justificativa (5 a 300 caracteres)")},
                modifier=Modifier.fillMaxWidth().testTag("scoped-workflow-note"))
            Text(if(isDecision)"Recomendar não remove mensagens nem aplica sanção."
                else "Somente outro moderador atribuído pode revisar o recurso.",
                style=MaterialTheme.typography.bodySmall)
            Button(enabled=decision.isNotBlank() && validScopedWorkflowNote(note.trim()),
                onClick={confirm=if(isDecision)"decide" else "review_appeal"},
                modifier=Modifier.testTag("scoped-workflow-decide")){
                Text(if(isDecision)"Registrar decisão" else "Registrar revisão")
            }
        }
        if(confirm!=null) Card(Modifier.fillMaxWidth().testTag("scoped-workflow-confirmation")) {
            Column(Modifier.fillMaxWidth().padding(12.dp),
                verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("Confirmar atendimento deste caso?",
                    style=MaterialTheme.typography.titleSmall)
                Text("A ação será auditada. Nenhuma sanção será aplicada automaticamente.")
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick={confirm=null},
                        modifier=Modifier.testTag("scoped-workflow-cancel")) { Text("Cancelar") }
                    TextButton(onClick={
            val operation=confirm ?: return@TextButton
            val selected=if(operation=="triage")null else decision
            val justification=if(operation=="triage")null else note.trim()
            confirm=null;stage=null;busy=true;message=""
            scope.launch {
                val reply=try{gateway.action(uid,channel,caseId,operation,selected,justification)}
                    catch(c:CancellationException){throw c}
                    catch(_:Exception){ScopedWorkflowReply.Error}
                if(currentUid.value!=uid)return@launch
                if(reply !is ScopedWorkflowReply.Stage){
                    busy=false;blocked.value(reply);return@launch
                }
                val checked=try{gateway.state(uid,channel,caseId)}
                    catch(c:CancellationException){throw c}
                    catch(_:Exception){ScopedWorkflowReply.Error}
                if(currentUid.value!=uid)return@launch
                busy=false
                if(checked is ScopedWorkflowReply.Stage && checked.stage==reply.stage){
                    stage=checked.stage;decision="";note="";message="Atendimento registrado."
                } else blocked.value(if(checked is ScopedWorkflowReply.Stage)
                    ScopedWorkflowReply.Error else checked)
            }
                    }, modifier=Modifier.testTag("scoped-workflow-confirm")) { Text("Confirmar") }
                }
            }
        }
    }

}

/** Recurso do DENUNCIANTE; estado não consultável pelo autor no contrato da #450. */
@Composable
internal fun ScopedCaseAppealPanel(
    uid:String,observedUid:String?,channel:String,suggestedCaseId:String?,
    gateway:ScopedCaseWorkflowGateway
){
    if(!BuildConfig.ATRIO_QA_GERAL_CELULAR_PILOT || BuildConfig.ATRIO_QA_GERAL_REMOTE)return
    var expanded by remember(uid,channel){mutableStateOf(false)}
    var caseId by remember(uid,channel){mutableStateOf("")}
    var reason by remember(uid,channel){mutableStateOf("")}
    var confirming by remember(uid,channel){mutableStateOf(false)}
    var busy by remember(uid,channel){mutableStateOf(false)}
    var feedback by remember(uid,channel){mutableStateOf("")}
    val scope=rememberCoroutineScope()
    val currentUid=rememberUpdatedState(observedUid)
    val valid=uid.isNotBlank() && uid==observedUid
    LaunchedEffect(uid,observedUid,channel){
        caseId="";reason="";confirming=false;expanded=false;busy=false;feedback=""
    }
    LaunchedEffect(suggestedCaseId,uid,observedUid){
        if(valid && suggestedCaseId?.startsWith(uid+"__")==true &&
            validScopedCaseId(suggestedCaseId)){caseId=suggestedCaseId;reason="";feedback=""}
    }
    if(!valid)return
    Column(Modifier.fillMaxWidth().padding(8.dp).testTag("scoped-appeal-panel"),
        verticalArrangement=Arrangement.spacedBy(8.dp)){
        TextButton(onClick={expanded=!expanded;if(!expanded){
            caseId="";reason="";feedback="";confirming=false}},
            modifier=Modifier.testTag("scoped-appeal-toggle")){
            Text("Recurso sobre denúncia enviada · QA")
        }
        if(expanded){
            Text("Somente o denunciante pode recorrer uma vez após decisão. " +
                "Não é possível consultar denúncias de outras pessoas.",
                style=MaterialTheme.typography.bodySmall)
            OutlinedTextField(caseId,{value->
                caseId=value.filter{it.code<128 && (it.isLetterOrDigit() || it=='_' || it=='-')}
                    .take(530);feedback=""
            },label={Text("Referência da minha denúncia")},singleLine=true,
                modifier=Modifier.fillMaxWidth().testTag("scoped-appeal-id"))
            OutlinedTextField(reason,{reason=it.take(300);feedback=""},
                label={Text("Justificativa do recurso (5 a 300 caracteres)")},
                modifier=Modifier.fillMaxWidth().testTag("scoped-appeal-reason"))
            Button(enabled=!busy && caseId.startsWith(uid+"__") &&
                validScopedCaseId(caseId) && validScopedWorkflowNote(reason.trim()),
                onClick={confirming=true},modifier=Modifier.testTag("scoped-appeal-submit")){
                Text("Enviar recurso")
            }
            if(feedback.isNotBlank())Text(feedback,modifier=Modifier.testTag("scoped-appeal-result"))
        }
    }
    if(confirming)AlertDialog(onDismissRequest={if(!busy)confirming=false},
        title={Text("Confirmar recurso?")},
        text={Text("Este recurso único será avaliado por outro moderador atribuído.")},
        confirmButton={TextButton(enabled=!busy,onClick={
            val requestedId=caseId;val requestedReason=reason.trim()
            confirming=false;busy=true;feedback=""
            scope.launch {
                val reply=try{gateway.appeal(uid,channel,requestedId,requestedReason)}
                    catch(c:CancellationException){throw c}
                    catch(_:Exception){ScopedWorkflowReply.Error}
                if(currentUid.value!=uid)return@launch
                busy=false;caseId="";reason=""
                feedback=when(reply){
                    is ScopedWorkflowReply.Stage -> if(reply.stage=="appealed")
                        "Recurso registrado para análise de outro moderador."
                        else "Não foi possível confirmar o recurso."
                    ScopedWorkflowReply.Unavailable -> "Recurso indisponível ou sem autorização."
                    ScopedWorkflowReply.Closed -> "Recursos indisponíveis neste ambiente."
                    ScopedWorkflowReply.Error -> "Não foi possível enviar. Tente novamente."
                }
            }
        },modifier=Modifier.testTag("scoped-appeal-confirm")) { Text("Confirmar envio") } },
        dismissButton={TextButton(onClick={confirming=false}) { Text("Cancelar") } }
    )
}
