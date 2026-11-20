package br.com.atriocatolico

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import java.time.LocalDate
import org.junit.Assert.assertTrue
import org.junit.Test

class LiturgicalPaletteTest {
    private fun ratio(a: Color, b: Color): Float {
        val l = a.luminance(); val r = b.luminance()
        return (maxOf(l,r)+.05f)/(minOf(l,r)+.05f)
    }
    @Test fun seasonalTextFocusAndActionContrast() {
        for (start in LiturgicalCalendarBR.TABLE.map { it.start } + LocalDate.parse("2028-01-01")) {
            for(dark in listOf(false,true)) {
                val s=liturgicalColors(LiturgicalCalendarBR.day(start),dark)
                for ((a,b) in listOf(s.primary to s.primaryContainer,s.onPrimary to s.primary,s.onSurface to s.surface,
                    s.onSurfaceVariant to s.background,s.error to s.background)) assertTrue("$start dark=$dark",ratio(a,b)>=4.5f)
                assertTrue(ratio(s.outline,s.surface)>=3f)
            }
        }
    }
}
