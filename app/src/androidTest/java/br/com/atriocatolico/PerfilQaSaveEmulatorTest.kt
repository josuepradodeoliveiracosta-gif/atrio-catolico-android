package br.com.atriocatolico

import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** O runner conecta o SDK aos emuladores; o script da suíte carrega as Rules do Perfil QA. */
class PerfilQaSaveEmulatorTest {
    @get:Rule val compose = createComposeRule()

    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private lateinit var uid: String
    private val privatePath get() = "profiles/$uid"
    private val publicPath get() = "public_profiles/$uid"
    private val name = "Pessoa de teste"
    private val bio = "Apresentação de teste"
    private val createdAt = "2024-01-01T00:00:00Z"

    @Before fun provisionOwner() {
        val app = FirebaseApp.getInstance()
        check(BuildConfig.DEBUG && app.options.projectId == "demo-atrio-v11")
        auth = FirebaseAuth.getInstance(app)
        db = FirebaseFirestore.getInstance(app)
        val email = "perfil-${UUID.randomUUID()}@qa.invalid"
        val password = "SenhaSinteticaParaTeste!"
        auth.signOut()
        uid = await(auth.createUserWithEmailAndPassword(email, password)).user!!.uid
        emulatorRequest(
            9099, "POST", "/identitytoolkit.googleapis.com/v1/projects/demo-atrio-v11/accounts:update",
            JSONObject().put("localId", uid).put("emailVerified", true)
        )
        auth.signOut()
        await(auth.signInWithEmailAndPassword(email, password))
        val denied = runCatching {
            await(db.document(privatePath).set(mapOf("displayName" to name, "createdAt" to Timestamp.now())))
        }.exceptionOrNull()
        check(denied is ExecutionException &&
            (denied.cause as? FirebaseFirestoreException)?.code ==
            FirebaseFirestoreException.Code.PERMISSION_DENIED) {
            "O emulador não negou a criação de perfil privado pelo titular."
        }
    }

    @After fun signOut() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun sameValuesCloseEditorWithoutWritingEitherDocument() {
        seed(privatePath, "createdAt")
        seedPublic()
        val privateBefore = document(privatePath).getString("updateTime")
        val publicBefore = document(publicPath).getString("updateTime")
        openEditor()

        clickSave("Nenhuma alteração no perfil de teste.")

        assertEquals(privateBefore, document(privatePath).getString("updateTime"))
        assertEquals(publicBefore, document(publicPath).getString("updateTime"))
        assertEquals(createdAt, field(document(publicPath), "updatedAt", "timestampValue"))
    }

    @Test fun normalizedValuesMatchCurrentSnapshotEvenWhenEditorIsStale() {
        seed(privatePath, "createdAt")
        openEditor()
        // Outra gravação no emulador enquanto os campos exibem o perfil anterior.
        val newName = "Outro nome"
        emulatorRequest(8089, "PATCH", documentEndpoint(privatePath) + "?updateMask.fieldPaths=displayName",
            JSONObject().put("fields", JSONObject()
                .put("displayName", JSONObject().put("stringValue", "  $newName  "))))
        val before = document(privatePath).getString("updateTime")
        compose.onNodeWithTag("perfilqa-name").performTextReplacement(" $newName ")
        clickSave("Nenhuma alteração no perfil de teste.")
        assertEquals(before, document(privatePath).getString("updateTime"))
        assertPublicMissing()
    }

    @Test fun realEditUpdatesBothDocumentsAndPreservesPublicJoinDate() {
        seed(privatePath, "createdAt")
        seedPublic()
        openEditor()
        compose.onNodeWithTag("perfilqa-name").performTextReplacement("Nome editado")
        compose.onNodeWithTag("perfilqa-bio").performTextReplacement("Bio editada")
        clickSave("Perfil de teste atualizado.")

        val privateProfile = document(privatePath)
        val publicProfile = document(publicPath)
        for (profile in listOf(privateProfile, publicProfile)) {
            assertEquals("Nome editado", field(profile, "displayName", "stringValue"))
            assertEquals("Bio editada", field(profile, "bio", "stringValue"))
        }
        assertEquals(createdAt, field(privateProfile, "createdAt", "timestampValue"))
        assertEquals(createdAt, field(publicProfile, "joinedAt", "timestampValue"))
        assertNotEquals(createdAt, field(publicProfile, "updatedAt", "timestampValue"))
    }

    @Test fun savingWithNoPublicProjectionLeavesMissingBioUnwrittenAndEditsOnlyPrivateProfile() {
        seed(privatePath, "createdAt", presentation = null)
        val before = document(privatePath).getString("updateTime")
        openEditor()
        clickSave("Nenhuma alteração no perfil de teste.")
        assertEquals(before, document(privatePath).getString("updateTime"))
        assertFalse(document(privatePath).getJSONObject("fields").has("bio"))

        enterEditMode()
        compose.onNodeWithTag("perfilqa-bio").performTextReplacement("Somente privada")
        clickSave("Perfil de teste atualizado.")
        assertEquals("Somente privada", field(document(privatePath), "bio", "stringValue"))
        assertPublicMissing()
    }

    @Test fun projectionRevokedWhileEditorIsOpenIsNotRecreatedByRealEdit() {
        seed(privatePath, "createdAt")
        seedPublic()
        openEditor()
        emulatorRequest(8089, "DELETE", documentEndpoint(publicPath))

        compose.onNodeWithTag("perfilqa-name").performTextReplacement("Nome privado")
        clickSave("Perfil de teste atualizado.")

        assertEquals("Nome privado", field(document(privatePath), "displayName", "stringValue"))
        assertPublicMissing()
    }

    private fun openEditor() {
        compose.setContent { AtrioTheme { PerfilQaPilotApp(auth, db) } }
        compose.waitUntil(30_000) {
            compose.onAllNodes(hasTestTag("perfilqa-profile")).fetchSemanticsNodes().isNotEmpty()
        }
        enterEditMode()
    }

    private fun enterEditMode() {
        compose.onNodeWithTag("perfilqa-profile").performScrollToNode(hasTestTag("perfilqa-edit"))
        compose.onNodeWithTag("perfilqa-edit").performClick()
    }

    private fun clickSave(message: String) {
        val profile = compose.onNodeWithTag("perfilqa-profile")
        profile.performScrollToNode(hasTestTag("perfilqa-save"))
        compose.onNodeWithTag("perfilqa-save").performClick()
        compose.waitUntil(30_000) {
            compose.onAllNodes(hasTestTag("perfilqa-edit")).fetchSemanticsNodes().isNotEmpty()
        }
        profile.performScrollToNode(hasTestTag("perfilqa-message"))
        compose.onNodeWithTag("perfilqa-message").assertTextEquals(message)
        compose.onNodeWithTag("perfilqa-save").assertDoesNotExist()
    }

    private fun seed(
        path: String,
        dateField: String,
        displayName: String = name,
        presentation: String? = bio
    ) {
        val date = JSONObject().put("timestampValue", createdAt)
        val fields = JSONObject()
            .put("displayName", JSONObject().put("stringValue", displayName))
            .put(dateField, date)
        if (presentation != null) {
            fields.put("bio", JSONObject().put("stringValue", presentation))
        }
        if (path == publicPath) fields.put("updatedAt", date)
        emulatorRequest(8089, "PATCH", documentEndpoint(path), JSONObject().put("fields", fields))
    }

    private fun seedPublic() = seed(publicPath, "joinedAt")

    private fun assertPublicMissing() {
        assertFalse(await(db.document(publicPath).get(Source.SERVER)).exists())
    }

    private fun document(path: String) =
        emulatorRequest(8089, "GET", documentEndpoint(path))

    private fun field(document: JSONObject, name: String, type: String) =
        document.getJSONObject("fields").getJSONObject(name).getString(type)

    private fun documentEndpoint(path: String) =
        "/v1/projects/demo-atrio-v11/databases/(default)/documents/$path"

    private fun emulatorRequest(port: Int, method: String, path: String, payload: JSONObject? = null): JSONObject {
        val connection = (URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = 5_000
            setRequestProperty("Authorization", "Bearer owner")
            if (payload != null) {
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
            }
        }
        return try {
            if (payload != null) connection.outputStream.use { it.write(payload.toString().toByteArray()) }
            check(connection.responseCode in 200..299) {
                "Fixture local recusada: $method $path HTTP ${connection.responseCode}"
            }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            if (body.isBlank()) JSONObject() else JSONObject(body)
        } finally {
            connection.disconnect()
        }
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 15, TimeUnit.SECONDS)
}
