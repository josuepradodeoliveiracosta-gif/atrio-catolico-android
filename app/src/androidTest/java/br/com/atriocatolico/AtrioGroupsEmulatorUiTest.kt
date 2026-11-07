package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * End-to-end: botões Compose + 2 contas Firebase Auth + Firestore local.
 * É proibido executar este teste com o Firebase oficial ou sem o seed
 * do emulador 127.0.0.1:9099/8089 (scripts/run-qa-android-emulator.sh).
 */
class AtrioGroupsEmulatorUiTest {
    @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
    private val demoProject="demo-atrio-v11"
    private val password="GrupoQa2026!Emulador"
    private lateinit var auth:FirebaseAuth
    private lateinit var db:FirebaseFirestore

    private fun initializeDemo() {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val current=FirebaseApp.getApps(context).firstOrNull {
            it.name==FirebaseApp.DEFAULT_APP_NAME
        } ?: FirebaseApp.initializeApp(context,
            FirebaseOptions.Builder()
                .setProjectId(demoProject)
                .setApplicationId("1:123456789012:android:0123456789abcdef")
                .setApiKey("local-emulator-test")
                .build())
        requireNotNull(current)
        check(BuildConfig.DEBUG && BuildConfig.PUSH_RELAY_URL.isBlank())
        check(current.options.projectId==demoProject)
        auth=FirebaseAuth.getInstance(current)
        db=FirebaseFirestore.getInstance(current)
        auth.useEmulator("127.0.0.1",9099)
        val host=db.firestoreSettings.host
        if(host!="127.0.0.1:8089") {
            check(host=="firestore.googleapis.com") {
                "QA inseguro: Firestore apontando para $host"
            }
            db.useEmulator("127.0.0.1",8089)
        }
        auth.signOut()
    }

    private fun login(email:String):String {
        val session=Tasks.await(auth.signInWithEmailAndPassword(
            email,password),25,TimeUnit.SECONDS)
        val id=requireNotNull(session.user?.uid)
        Tasks.await(session.user!!.getIdToken(false),15,TimeUnit.SECONDS)
        return id
    }

    private fun waitFor(tag:String,timeout:Long=30_000) {
        compose.waitUntil(timeout) {
            compose.onAllNodesWithTag(tag,useUnmergedTree=true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    @After fun signOut() {
        if(::auth.isInitialized) auth.signOut()
    }

    @Test fun criarConvidarAceitarEnviarESairPelaInterfaceReal() {
        initializeDemo()
        // Cadastro, chats aceitos e segurança são preparados previamente
        // APENAS no emulador pelo script seed-chat-groups-android.mjs.
        val bob=login("group.bob@qa.invalid")
        auth.signOut()
        val alice=login("group.alice@qa.invalid")

        var screenUid by mutableStateOf(alice)
        compose.setContent {
            AtrioTheme {
                AtrioGroupsScreen(
                    db=db,uid=screenUid,
                    knownPeers=if(screenUid==alice) listOf(bob) else listOf(alice),
                    onBack={}
                )
            }
        }
        waitFor("atrio-group-create-open")
        compose.onNodeWithTag("atrio-group-create-open").performClick()
        waitFor("atrio-group-title")
        val title="Grupo de estudo QA"
        compose.onNodeWithTag("atrio-group-title").performTextInput(title)
        compose.onNodeWithTag("atrio-group-create").performClick()

        var groupId=""
        compose.waitUntil(40_000) {
            runCatching {
                val snap=Tasks.await(
                    db.collection("chat_groups")
                        .whereArrayContains("memberUids",alice)
                        .get(Source.SERVER),5,TimeUnit.SECONDS)
                groupId=snap.documents.firstOrNull {
                    it.getString("name")==title
                }?.id.orEmpty()
                groupId.isNotEmpty()
            }.getOrDefault(false)
        }
        waitFor("atrio-group-thread")
        compose.onNodeWithTag("atrio-group-members").performClick()
        waitFor("atrio-group-invite-open")
        compose.onNodeWithTag("atrio-group-invite-open").performClick()
        waitFor("atrio-group-invite-"+bob)
        compose.onNodeWithTag("atrio-group-invite-"+bob).performClick()

        val invitePath="chat_groups/$groupId/atrioGroupInvites/$bob"
        compose.waitUntil(35_000) {
            runCatching {
                Tasks.await(db.document(invitePath).get(Source.SERVER),
                    5,TimeUnit.SECONDS).getString("status")=="pending"
            }.getOrDefault(false)
        }

        auth.signOut()
        assertEquals(bob,login("group.bob@qa.invalid"))
        compose.runOnIdle { screenUid=bob }
        waitFor("atrio-group-accept-"+groupId,35_000)
        compose.onNodeWithTag("atrio-group-accept-"+groupId).performClick()
        compose.waitUntil(35_000) {
            runCatching {
                Tasks.await(db.collection("chat_groups").document(groupId)
                    .get(Source.SERVER),5,TimeUnit.SECONDS)
                    .get("memberUids").let { it as? List<*> }
                    ?.contains(bob)==true
            }.getOrDefault(false)
        }
        waitFor("atrio-group-thread")
        val message="Paz e bem! Mensagem do Miguel no grupo de estudo."
        compose.onNodeWithTag("atrio-group-composer").performTextInput(message)
        compose.onNodeWithTag("atrio-group-send").performClick()
        compose.waitUntil(35_000) {
            runCatching {
                val results=Tasks.await(
                    db.collection("chat_groups").document(groupId)
                        .collection("messages").get(Source.SERVER),
                    5,TimeUnit.SECONDS)
                results.documents.any {
                    it.getString("uid")==bob && it.getString("text")==message
                        && it.getString("kind")=="text"
                }
            }.getOrDefault(false)
        }
        // O mesmo participante sai pela interface, sem apagar o texto
        // para o criador. O Firestore nega leitura posterior ao ex-membro.
        compose.onNodeWithTag("atrio-group-members").performClick()
        waitFor("atrio-group-leave")
        compose.onNodeWithTag("atrio-group-leave").performClick()
        compose.waitUntil(30_000) {
            runCatching {
                val owner=Tasks.await(
                    db.collection("chat_groups")
                        .whereArrayContains("memberUids",bob)
                        .get(Source.SERVER),5,TimeUnit.SECONDS)
                owner.documents.none { it.id==groupId }
            }.getOrDefault(false)
        }
        val canRead=runCatching {
            Tasks.await(db.collection("chat_groups").document(groupId)
                .collection("messages").get(Source.SERVER),
                6,TimeUnit.SECONDS)
        }.isSuccess
        assertTrue("Ex-membro não pode ler grupo no servidor",!canRead)

        auth.signOut()
        assertEquals(alice,login("group.alice@qa.invalid"))
        val remaining=Tasks.await(
            db.collection("chat_groups").document(groupId)
                .collection("messages").get(Source.SERVER),
            8,TimeUnit.SECONDS)
        assertTrue("Criador mantém histórico após saída do convidado",
            remaining.documents.any { it.getString("text")==message })
    }
}
