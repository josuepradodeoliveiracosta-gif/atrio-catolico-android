package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Test

class QaShopAccessTest {
    @Test fun onlyConfirmedQaRemoteFunctionalOptInMayOpenTheShop() {
        for (type in listOf("qaGeral", "release", "debug", "perfilQa", "chatQa")) {
            for (project in listOf("atrio-catolico-qa-general", "atrio-catolico", "demo-atrio-v11", null)) {
                for (remote in listOf(false, true)) for (functional in listOf(false, true)) {
                    for (confirmed in listOf(false, true)) for (enabled in listOf(false, true)) {
                        val expected = type == "qaGeral" && project == "atrio-catolico-qa-general" &&
                            remote && functional && confirmed && enabled
                        assertEquals(expected, QaShopAccess.allowed(type, remote, functional, project, confirmed, enabled))
                    }
                }
            }
        }
    }
}
