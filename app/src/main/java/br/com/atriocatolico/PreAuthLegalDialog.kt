package br.com.atriocatolico

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AlertDialogDefaults
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** Keep the native modal window and its accessibility/dismiss behavior.
 * Do not replay the form or blur window contents: they can include credentials.
 * The conservative tint is safe even if the system dims nothing behind it. */
@Composable
internal fun PreAuthLegalDialog(
    glass: Boolean,
    onDismissRequest: () -> Unit,
    title: @Composable () -> Unit,
    text: @Composable () -> Unit,
    confirmLabel: String,
    onConfirm: () -> Unit,
) {
    if (!glass) {
        AlertDialog(onDismissRequest = onDismissRequest, title = title, text = text,
            confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel) } })
        return
    }
    val heading = Color(PreAuthGlassPolicy.MODAL_TITLE)
    AlertDialog(
        onDismissRequest = onDismissRequest,
        modifier = Modifier.testTag("atrio-preauth-legal-glass")
            .border(1.dp, Color(PreAuthGlassPolicy.MODAL_OUTLINE).copy(alpha = .55f),
                AlertDialogDefaults.shape),
        title = title,
        text = text,
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.heightIn(min = 48.dp),
                colors = ButtonDefaults.textButtonColors(contentColor = heading)) {
                Text(confirmLabel)
            }
        },
        containerColor = Color(PreAuthGlassPolicy.modalSurface()),
        titleContentColor = heading,
        textContentColor = Color(PreAuthGlassPolicy.MODAL_BODY),
        tonalElevation = 0.dp,
    )
}
