package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayInputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLPeerUnverifiedException

class QaConversationNoticeHttpTest {
    private val origin = "https://notice-qa.example.invalid"
    private val transport = requireNotNull(QaConversationNoticeHttp.https(origin))

    @Test fun consultaAutenticadaUsaSomenteOrigemECaminhoConfigurados() {
        val response = transport.read("token-do-ensaio") { url ->
            assertEquals("$origin/notice", url.toExternalForm())
            StubHttps(url).apply {
                verifyRequest = {
                    assertEquals("GET", requestMethod)
                    assertEquals("Bearer token-do-ensaio", getRequestProperty("Authorization"))
                    assertEquals("no-store", getRequestProperty("Cache-Control"))
                    assertFalse(instanceFollowRedirects)
                    assertFalse(useCaches)
                }
            }
        }
        assertEquals("{}", response)
    }

    @Test fun recusaOrigemCaminhoEConfiguracaoInvalidosAntesDeAnexarCredencial() {
        for (url in listOf("https://other.example.invalid/notice", "$origin/outra-rota")) {
            val wrongDestination = StubHttps(URL(url))
            wrongDestination.verifyRequest = { error("A origem ou rota incorreta recebeu a consulta") }
            assertNull(transport.read("token-do-ensaio") { wrongDestination })
            assertNull(wrongDestination.getRequestProperty("Authorization"))
        }
        for (invalid in listOf("http://notice-qa.example.invalid", "$origin:443", "$origin/",
            "$origin?x=y", "https://user@notice-qa.example.invalid", "https://127.0.0.1",
            "https://atrio-push.atrio-catolico.workers.dev"
        )) assertNull(QaConversationNoticeHttp.https(invalid))
        assertNull(QaConversationNoticeHttp.loopback("http://other.example.invalid:8092/notice"))
    }

    @Test fun recusaRedirecionamentoMesmoNaMesmaOrigem() {
        for (location in listOf("$origin/other", "https://other.example.invalid/notice")) {
            var connections = 0
            assertNull(transport.read("token-do-ensaio") { url ->
                connections++
                StubHttps(url, 302, location).apply {
                    verifyRequest = { assertFalse(instanceFollowRedirects) }
                }
            })
            assertEquals(1, connections)
        }
    }

    @Test fun falhaDeValidacaoTlsFechaAConsulta() {
        assertNull(transport.read("token-do-ensaio") { url ->
            StubHttps(url).apply {
                verifyRequest = { throw SSLPeerUnverifiedException("certificado do ensaio") }
            }
        })
    }

    @Test fun diagnosticoInformaSomenteCodigoSemSeguirRedirect() {
        val statuses = mutableListOf<Int>()
        for (status in listOf(200, 401, 404, 503, 302)) {
            val result = transport.readDiagnosed("token-do-ensaio", { statuses.add(it) }) { url ->
                StubHttps(url, status, "https://other.example.invalid/notice").apply {
                    verifyRequest = { assertFalse(instanceFollowRedirects) }
                }
            }
            assertEquals(if (status == 200) "{}" else null, result)
        }
        assertEquals(listOf(200, 401, 404, 503, 302), statuses)
        assertNull(transport.readDiagnosed("token-do-ensaio", { statuses.add(it) }) { url ->
            StubHttps(url).apply {
                verifyRequest = { throw SSLPeerUnverifiedException("fixture-secret") }
            }
        })
        assertEquals(0, statuses.last())
    }

    private class StubHttps(url: URL, private val status: Int = 200, private val location: String? = null) :
        HttpsURLConnection(url) {
        var verifyRequest: () -> Unit = {}
        override fun getResponseCode(): Int {
            verifyRequest()
            return status
        }
        override fun getHeaderField(name: String?) = location.takeIf { name == "Location" }
        override fun getInputStream(): ByteArrayInputStream {
            check(status == 200)
            return ByteArrayInputStream("{}".toByteArray())
        }
        override fun connect() = Unit
        override fun disconnect() = Unit
        override fun usingProxy() = false
        override fun getCipherSuite() = ""
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
    }
}
