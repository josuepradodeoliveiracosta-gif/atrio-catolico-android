package br.com.atriocatolico

import android.app.Activity
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.view.doOnPreDraw
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One-shot local measurement, main-thread only, never armed by production. */
internal object QaAndroidOpeningProbe {
    private var generation = 0L
    private var armed = false
    private var measured: Long? = null
    fun arm() { generation++; measured = null; armed = true }
    fun reset() { generation++; measured = null; armed = false }
    fun value(): Long? = measured
    fun attach(activity: Activity) {
        if (!armed || QaAndroidDiagnosticPolicy.environment(
                BuildConfig.BUILD_TYPE, activity.packageName) == null) return
        armed = false
        val ticket = generation
        val started = SystemClock.elapsedRealtime()
        activity.window.decorView.doOnPreDraw {
            if (ticket == generation && !activity.isDestroyed)
                measured = QaAndroidDiagnosticPolicy.openingMillis(started, SystemClock.elapsedRealtime())
        }
    }
}

private data class QaLocalSnapshot(
    val exits: String, val memory: String, val network: String, val auth: String
)
private fun localRead(block: () -> String): String = try { block() }
    catch (_: Exception) { "Não foi possível verificar" }

private fun sample(context: Context, environment: String): QaLocalSnapshot {
    val exits = localRead {
        if (Build.VERSION.SDK_INT < 30) "Histórico indisponível (requer API 30)"
        else {
            val manager = context.getSystemService(ActivityManager::class.java)
            val records = manager.getHistoricalProcessExitReasons(context.packageName, 0, 5)
                .filter { it.processName == context.packageName }
            val counts = QaAndroidDiagnosticPolicy.exits(records.map {
                when (it.reason) {
                    ApplicationExitInfo.REASON_CRASH, ApplicationExitInfo.REASON_CRASH_NATIVE ->
                        QaAndroidDiagnosticPolicy.Exit.CRASH
                    ApplicationExitInfo.REASON_ANR -> QaAndroidDiagnosticPolicy.Exit.ANR
                    else -> QaAndroidDiagnosticPolicy.Exit.OTHER
                }
            })
            if (counts.inspected == 0) "Nenhum registro disponível; não comprova ausência de falhas"
            else "Registros: ${counts.inspected}; travamentos: ${counts.crashes}; ANR: ${counts.anrs}"
        }
    }
    val memory = localRead {
        val runtime = Runtime.getRuntime()
        val percent = QaAndroidDiagnosticPolicy.heapPercent(runtime.totalMemory() - runtime.freeMemory(), runtime.maxMemory())
        val info = ActivityManager.MemoryInfo()
        context.getSystemService(ActivityManager::class.java).getMemoryInfo(info)
        val pressure = if (info.lowMemory) "pressão de memória sinalizada" else "sem alerta do sistema"
        "Heap JVM: ${percent?.let { "$it%" } ?: "não medido"}; $pressure"
    }
    val network = localRead {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val active = manager.activeNetwork
        val caps = active?.let { manager.getNetworkCapabilities(it) }
        when {
            active == null -> "Sem rede ativa detectada"
            caps == null -> "Estado da rede desconhecido"
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ->
                "Rede validada pelo Android; Firebase não testado"
            else -> "Rede ativa sem validação do Android"
        }
    }
    val auth = localRead {
        val app = FirebaseApp.getApps(context).singleOrNull()
        when {
            app == null || app.name != FirebaseApp.DEFAULT_APP_NAME -> "Firebase padrão não confirmado"
            !QaAndroidDiagnosticPolicy.approvedProject(environment, app.options.projectId) ->
                "Projeto QA não confirmado; sessão não consultada"
            FirebaseAuth.getInstance(app).currentUser != null ->
                "Sessão local presente; validade remota não verificada"
            else -> "Nenhuma sessão local"
        }
    }
    return QaLocalSnapshot(exits, memory, network, auth)
}

/** QA launcher only. Ignores Intent extras; collection requires an explicit tap. */
class QaAndroidDiagnosticsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val env = QaAndroidDiagnosticPolicy.environment(BuildConfig.BUILD_TYPE, packageName)
        if (env == null || BuildConfig.ATRIO_QA_GERAL_CELULAR_FICTICIO ||
            BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB) { finish(); return }
        setContent {
            AtrioTheme {
                var snapshot by remember { mutableStateOf<QaLocalSnapshot?>(null) }
                var opening by remember { mutableStateOf<Long?>(null) }
                var busy by remember { mutableStateOf(false) }
                val scope = rememberCoroutineScope()
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Diagnóstico local QA", style = MaterialTheme.typography.headlineSmall,
                            modifier = Modifier.semantics { heading() })
                        Text(env)
                        Text("Coleta voluntária, somente nesta sessão. O painel não salva nem transmite dados.")
                        Button(enabled = !busy, onClick = {
                            busy = true
                            scope.launch {
                                try {
                                    snapshot = withContext(Dispatchers.IO) { sample(applicationContext, env) }
                                    opening = QaAndroidOpeningProbe.value()
                                } finally { busy = false }
                            }
                        }) { Text(if (busy) "Verificando…" else "Coletar / atualizar") }
                        Text("Travamentos e ANR", style = MaterialTheme.typography.titleMedium)
                        Text(snapshot?.exits ?: "Não coletado")
                        Text("Memória", style = MaterialTheme.typography.titleMedium)
                        Text(snapshot?.memory ?: "Não coletado")
                        Text("Conectividade", style = MaterialTheme.typography.titleMedium)
                        Text(snapshot?.network ?: "Não coletado")
                        Text("Autenticação", style = MaterialTheme.typography.titleMedium)
                        Text(snapshot?.auth ?: "Não coletado")
                        Text("Desempenho de abertura", style = MaterialTheme.typography.titleMedium)
                        Text(opening?.let { "$it ms até o primeiro pré-desenho" } ?: "Não medido")
                        Text("Mede uma abertura de Activity, não cold start completo nem FPS.")
                        OutlinedButton(enabled = !busy, onClick = {
                            QaAndroidOpeningProbe.arm()
                            opening = null
                            val target = if (env == "perfil_qa") PerfilQaActivity::class.java else MainActivity::class.java
                            try { startActivity(Intent(this@QaAndroidDiagnosticsActivity, target)) }
                            catch (_: Exception) { QaAndroidOpeningProbe.reset() }
                        }) { Text("Medir uma abertura do aplicativo") }
                        Text("Retorne ao painel e toque em Coletar / atualizar para ler a medição.")
                        TextButton(enabled = !busy, onClick = {
                            snapshot = null; opening = null; QaAndroidOpeningProbe.reset()
                        }) { Text("Limpar diagnóstico") }
                        Text("Ausência de registros ou alertas não comprova saúde.")
                    }
                }
            }
        }
    }
}
