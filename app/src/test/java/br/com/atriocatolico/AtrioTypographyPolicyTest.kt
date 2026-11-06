package br.com.atriocatolico

import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AtrioTypographyPolicyTest {
    @Test fun escalaRespeitaLegibilidadeSemRedimensionarTitulos() {
        assertEquals(16.sp, AtrioType.reading)
        assertEquals(24.sp, AtrioType.readingLine)
        assertEquals(15.sp, AtrioType.author)
        assertTrue(AtrioType.uiAction.value >= 14f)
        assertTrue(AtrioType.secondary.value >= 14f)
        assertTrue(AtrioType.compact.value >= 13f)
        assertTrue(AtrioType.metadata.value >= 12f)
    }

    @Test fun temaMaterialPossuiTextosDeLeituraMaiores() {
        assertEquals(16.sp, AtrioMaterialTypography.bodyLarge.fontSize)
        assertEquals(15.sp, AtrioMaterialTypography.bodyMedium.fontSize)
        assertEquals(14.sp, AtrioMaterialTypography.bodySmall.fontSize)
        assertEquals(13.sp, AtrioMaterialTypography.labelMedium.fontSize)
        assertEquals(12.sp, AtrioMaterialTypography.labelSmall.fontSize)
    }
}
