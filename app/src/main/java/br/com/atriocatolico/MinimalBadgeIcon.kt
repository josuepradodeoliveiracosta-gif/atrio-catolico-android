package br.com.atriocatolico

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.Church
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Identidade visual minimalista, desenhada diretamente com vetores do Compose.
 * A aparência de um selo nunca concede permissões de segurança.
 * Mantemos os recursos gráficos antigos intactos para compatibilidade.
 */
@Composable
internal fun MinimalBadgeIcon(kind: String, modifier: Modifier = Modifier) {
    val (background, foreground) = when (kind) {
        "fundador" -> Color(0xFF710E22) to Color(0xFFF6CD75)
        "padre" -> Color(0xFFFBF0D5) to Color(0xFFA7770A)
        "diacono" -> Color(0xFF195860) to Color.White
        "religioso", "religiosa" -> Color(0xFFEDE4D9) to Color(0xFF70523D)
        "moderador" -> Color(0xFF710E22) to Color(0xFFF6CD75)
        else -> Color(0xFFE8E6E1) to Color(0xFF57534E)
    }
    Box(
        modifier = modifier.clip(CircleShape).background(background),
        contentAlignment = Alignment.Center
    ) {
        when (kind) {
            "padre" -> Text("✝", color = foreground, fontSize = 16.sp,
                fontWeight = FontWeight.Bold)
            else -> {
                val vector = when (kind) {
                    "fundador" -> Icons.Outlined.AccountBalance
                    "diacono" -> Icons.Outlined.Church
                    "religioso", "religiosa" -> Icons.Outlined.MenuBook
                    "moderador" -> Icons.Outlined.VerifiedUser
                    else -> Icons.Outlined.PersonOutline
                }
                Icon(vector, contentDescription = null, tint = foreground,
                    modifier = Modifier.size(15.dp))
            }
        }
    }
}
