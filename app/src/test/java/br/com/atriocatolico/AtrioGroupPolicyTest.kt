package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Limites experimentais: as permissões efetivas são sempre do Firestore. */
class AtrioGroupPolicyTest {
    @Test fun nomesCurtoLongoEComEspacos() {
        assertTrue(AtrioGroupPolicy.eligibleTitle("Estudo bíblico"))
        assertFalse(AtrioGroupPolicy.eligibleTitle("Oi"))
        assertFalse(AtrioGroupPolicy.eligibleTitle(" nome com espaços "))
        assertFalse(AtrioGroupPolicy.eligibleTitle("G".repeat(81)))
        assertTrue(AtrioGroupPolicy.eligibleTitle("G".repeat(80)))
        assertFalse(AtrioGroupPolicy.eligibleTitle("Texto\u0000invisível"))
    }

    @Test fun tiposDeGruposMantemIdentidadePropria() {
        assertEquals("Estudo", AtrioGroupPolicy.categoryName("study"))
        assertEquals("Oração", AtrioGroupPolicy.categoryName("prayer"))
        assertEquals("Comunidade", AtrioGroupPolicy.categoryName("community"))
        assertEquals(8, AtrioGroupPolicy.MAX_MEMBERS)
    }
}
