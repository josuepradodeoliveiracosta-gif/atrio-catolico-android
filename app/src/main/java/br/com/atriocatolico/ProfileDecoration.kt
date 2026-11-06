package br.com.atriocatolico

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/**
 * Ornamento vetorial discreto, sem arquivos externos nem requisições.
 * Inspiração na arquitetura de basílicas; não interfere em controles.
 */
@Composable
internal fun ProfileBasilicaFooter() {
    Canvas(Modifier.fillMaxWidth().height(90.dp)) {
        val w = size.width
        val h = size.height
        val center = w * 0.78f
        val goldTint = Gold.copy(alpha = 0.40f)
        val wineTint = Wine.copy(alpha = 0.90f)
        val base = h * 0.82f

        // Cúpula e lanterna.
        drawArc(goldTint, startAngle = 180f, sweepAngle = 180f, useCenter = false,
            topLeft = Offset(center - 49f, h * 0.22f), size = Size(98f, 98f),
            style = Stroke(width = 2.5f))
        drawLine(goldTint, Offset(center - 49f, h * 0.49f), Offset(center - 49f, base), 2f)
        drawLine(goldTint, Offset(center + 49f, h * 0.49f), Offset(center + 49f, base), 2f)
        drawLine(goldTint, Offset(center, h * 0.06f), Offset(center, h * 0.22f), 2f)
        drawLine(goldTint, Offset(center - 7f, h * 0.12f), Offset(center + 7f, h * 0.12f), 2f)
        drawLine(goldTint, Offset(center, h * 0.2f), Offset(center, base), 1.5f)

        // Fachada com colunas, cornijas e arcadas.
        drawRect(goldTint, topLeft = Offset(center - 96f, base - 22f),
            size = Size(192f, 24f), style = Stroke(width = 2f))
        drawLine(goldTint, Offset(center - 118f, base - 25f), Offset(center + 118f, base - 25f), 2f)
        for (index in -3..3) {
            val x = center + index * 27f
            drawLine(goldTint, Offset(x, base - 20f), Offset(x, base), 2f)
        }

        // Faixa orgânica vinho/dourado como no modelo de referência.
        val curve = Path().apply {
            moveTo(0f, h * 0.90f)
            quadraticTo(w * 0.45f, h * 1.15f, w, h * 0.73f)
        }
        drawPath(curve, color = Gold, style = Stroke(width = 5f))
        val lower = Path().apply {
            moveTo(0f, h * 0.94f)
            quadraticTo(w * 0.45f, h * 1.18f, w, h * 0.77f)
        }
        drawPath(lower, color = wineTint, style = Stroke(width = 6f))
    }
}
