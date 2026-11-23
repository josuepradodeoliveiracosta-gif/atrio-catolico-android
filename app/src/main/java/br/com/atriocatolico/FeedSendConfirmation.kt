package br.com.atriocatolico

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

@Composable
internal fun rememberFeedSendConfirmation(): (String, () -> Unit) -> Unit {
    var warning by remember { mutableStateOf<GuardianPreflight.Warning?>(null) }
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    fun resolve(confirmed: Boolean) {
        val action = pending
        pending = null
        warning = null
        if (confirmed) action?.invoke()
    }
    warning?.let { current ->
        AlertDialog(
            onDismissRequest = { resolve(false) },
            title = { Text("Aviso preventivo · Átrio Guardião") },
            text = { Text(current.explanation) },
            confirmButton = { TextButton(onClick = { resolve(true) }) { Text("Enviar mesmo assim") } },
            dismissButton = { TextButton(onClick = { resolve(false) }) { Text("Revisar texto") } },
        )
    }
    return { text, send ->
        if (pending == null) {
            val result = GuardianPreflight.inspect(text)
            if (result == null) send()
            else {
                warning = result
                pending = send
            }
        }
    }
}
