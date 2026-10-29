package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FirebaseFirestore

internal data class MyDiscussion(
    val id: String,
    val title: String,
    val category: String,
    val createdAtSeconds: Long
)

/**
 * Busca independente do feed, executada só quando o usuário abre seu histórico.
 * A consulta por UID não exige novo índice composto; o limite reduz leituras.
 */
@Composable
internal fun ProfileDiscussionHistory(
    db: FirebaseFirestore,
    uid: String,
    onBack: () -> Unit,
    onOpen: (String) -> Unit
) {
    var entries by remember(uid) { mutableStateOf<List<MyDiscussion>>(emptyList()) }
    var loading by remember(uid) { mutableStateOf(true) }
    var error by remember(uid) { mutableStateOf(false) }
    var refresh by remember(uid) { mutableIntStateOf(0) }

    DisposableEffect(db, uid, refresh) {
        var active = true
        loading = true
        error = false
        db.collection("posts").whereEqualTo("uid", uid).limit(50).get()
            .addOnCompleteListener { result ->
                if (!active) return@addOnCompleteListener
                loading = false
                error = !result.isSuccessful
                if (result.isSuccessful) {
                    entries = result.result?.documents.orEmpty().mapNotNull { doc ->
                        if (doc.getString("uid") != uid) return@mapNotNull null
                        MyDiscussion(
                            id = doc.id,
                            title = doc.getString("title").orEmpty().ifBlank { "Discussão sem título" },
                            category = doc.getString("category").orEmpty(),
                            createdAtSeconds = doc.getTimestamp("createdAt")?.seconds ?: 0L
                        )
                    }.sortedByDescending { it.createdAtSeconds }
                }
            }
        onDispose { active = false }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("atrio-profile-history"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            TextButton(onClick = onBack) { Text("Voltar ao perfil") }
            Text("Minhas discussões", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Até 50 discussões desta conta. Os resultados são consultados no Firestore " +
                    "ao abrir esta tela; não incluem necessariamente todo o histórico.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (loading) item { CircularProgressIndicator(Modifier.testTag("atrio-history-loading")) }
        if (error) item {
            Text("Não foi possível carregar as discussões. Confira a conexão e tente novamente.",
                color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { refresh++ }) { Text("Tentar novamente") }
        }
        if (!loading && !error && entries.isEmpty()) item {
            Text("Nenhuma discussão encontrada nesta conta.",
                style = MaterialTheme.typography.bodyMedium)
        }
        if (!loading && !error) {
            items(entries, key = { it.id }) { item ->
                Card(onClick = { onOpen(item.id) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text(item.title, style = MaterialTheme.typography.titleMedium)
                        if (item.category.isNotBlank()) Text(item.category,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
