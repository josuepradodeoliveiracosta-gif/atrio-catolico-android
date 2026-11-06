package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class DeveloperSupportDataTest {
    @Test fun startsPrivateAndWithoutMockBankData() {
        val data = DeveloperSupportData()
        assertFalse(data.enabled)
        assertFalse(data.hasPaymentMethod)
        assertTrue(data.valid)
        assertEquals("", data.pixKey)
    }

    @Test fun publishingRequiresValidPaymentMethod() {
        assertFalse(DeveloperSupportData(enabled = true).valid)
        assertTrue(DeveloperSupportData(enabled = true, pixKey = "teste-pix").valid)
        assertTrue(DeveloperSupportData(enabled = true,
            bankName = "Banco teste", agency = "0001", account = "1234-5").valid)
    }

    @Test fun incompleteBankDataCannotBePublished() {
        assertTrue(DeveloperSupportData(enabled = false, bankName = "Banco teste").valid)
        assertFalse(DeveloperSupportData(enabled = true,
            pixKey = "teste-pix", bankName = "Banco teste").valid)
    }

    @Test fun fieldsAreTrimmedBeforeSaving() {
        val result = DeveloperSupportData(
            enabled = true, pixKey = "  teste-pix  ", bankName = "  Banco  ",
            agency = "  0001  ", account = "  123  ", message = "  Apoie  "
        ).normalized()
        assertEquals("teste-pix", result.pixKey)
        assertEquals("Banco", result.bankName)
        assertEquals("0001", result.agency)
        assertEquals("123", result.account)
        assertEquals("Apoie", result.message)
    }
}
