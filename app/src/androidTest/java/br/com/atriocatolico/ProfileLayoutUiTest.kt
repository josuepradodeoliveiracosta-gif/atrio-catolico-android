package br.com.atriocatolico

import android.graphics.Bitmap
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import android.os.Build
import android.os.ParcelFileDescriptor
import com.google.firebase.FirebaseApp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.android.gms.tasks.Tasks
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Tela conectada real, com UID sintético e Firebase limitado pelo runner ao emulador. */
class ProfileLayoutUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun profileToolbarShowsAWorkingSettingsGear() {
        var opened = false
        compose.setContent {
            AtrioTheme {
                AtrioTopBar(
                    details = false, onBack = {}, onSearch = {}, onNotification = {},
                    profileMode = true, onProfileSettings = { opened = true }
                )
            }
        }
        compose.onNodeWithTag("atrio-profile-settings").assertIsDisplayed().performClick()
        compose.runOnIdle { assertTrue(opened) }
    }

    @Test fun settingsMenuOpensAccountAndPrivacyControls() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        val menuOpen = mutableStateOf(true)
        compose.setContent {
            AtrioTheme {
                OnlineProfileScreen(
                    db = FirebaseFirestore.getInstance(), uid = "profile-settings-menu",
                    name = "Maria da Comunidade", email = "maria@example.test",
                    biography = "", onSignOut = {}, onModeration = null, onClergyReview = null,
                    onOpen = {}, onNotifications = {}, onReviews = {},
                    profileSettingsMenuOpen = menuOpen.value,
                    onCloseProfileSettingsMenu = { menuOpen.value = false }
                )
            }
        }
        compose.onNodeWithTag("atrio-profile-settings-account").performClick()
        compose.runOnIdle { assertEquals(false, menuOpen.value) }
        val list = compose.onNodeWithTag("atrio-profile-list")
        list.performScrollToNode(hasTestTag("atrio-profile-signout"))
        compose.onNodeWithTag("atrio-profile-signout").assertIsDisplayed()
    }

    @Test fun sectionsRemainReachableWithLargeText() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        var destination = ""
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.5f)) {
                AtrioTheme {
                    OnlineProfileScreen(
                        db = FirebaseFirestore.getInstance(), uid = "profile-layout-only",
                        name = "Maria da Comunidade", email = "maria@example.test",
                        biography = "Uma caminhada de fé e comunidade.",
                        onSignOut = { destination = "logout" },
                        onModeration = null, onClergyReview = null,
                        onOpen = {},
                        onNotifications = { destination = "notices" }, onReviews = { destination = "reviews" }
                    )
                }
            }
        }
        screenshot("01-identidade-fonte-ampliada")
        val list = compose.onNodeWithTag("atrio-profile-list")
        list.performScrollToNode(hasText("Minhas discussões"))
        compose.onNodeWithText("Minhas discussões").performClick()
        compose.onNodeWithTag("atrio-profile-history").assertExists()
        compose.onNodeWithText("Voltar ao perfil").performClick()
        compose.onNodeWithText("Publicações salvas").assertDoesNotExist()
        list.performScrollToNode(hasText("Minhas revisões"))
        compose.onNodeWithText("Minhas revisões").performClick()
        compose.runOnIdle { assertEquals("reviews", destination) }
        list.performScrollToNode(hasText("Abrir central de notificações"))
        compose.onNodeWithText("Abrir central de notificações").performClick()
        compose.runOnIdle { assertEquals("notices", destination) }
        list.performScrollToNode(hasContentDescription("Receber avisos neste aparelho"))
        compose.onNodeWithContentDescription("Receber avisos neste aparelho").assertIsOff()
        screenshot("02-notificacoes-fonte-ampliada")
        list.performScrollToNode(hasTestTag("atrio-account-toggle"))
        compose.onNodeWithTag("atrio-account-toggle").performClick()
        list.performScrollToNode(hasTestTag("atrio-profile-signout"))
        compose.onNodeWithTag("atrio-profile-signout").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals("logout", destination) }
        screenshot("03-conta-fonte-ampliada")
        list.performScrollToNode(hasTestTag("atrio-help-toggle"))
        compose.onNodeWithTag("atrio-ota-section").assertDoesNotExist()
        compose.onNodeWithTag("atrio-help-toggle").performClick()
        compose.onNodeWithTag("atrio-ota-section").assertExists()
        compose.onNodeWithText("Ferramentas avançadas de notificações").assertExists()
        compose.onNodeWithTag("atrio-help-toggle").performClick()
        compose.onNodeWithTag("atrio-ota-section").assertDoesNotExist()
        compose.onNodeWithTag("atrio-profile-publications").assertDoesNotExist()
        compose.onNodeWithTag("atrio-profile-create-discussion").assertDoesNotExist()
    }

    @Test fun developerSupportStartsClosedAndCanBeExpanded() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        compose.setContent {
            AtrioTheme {
                OnlineProfileScreen(
                    db = FirebaseFirestore.getInstance(), uid = "profile-layout-only",
                    name = "Maria da Comunidade", email = "maria@example.test",
                    biography = "", onSignOut = {}, onModeration = null, onClergyReview = null,
                    onOpen = {},
                    onNotifications = {}, onReviews = {}
                )
            }
        }
        val list = compose.onNodeWithTag("atrio-profile-list")
        list.performScrollToNode(hasTestTag("atrio-support-toggle"))
        compose.onNodeWithContentDescription("Expandir apoio").assertExists()
        compose.onNodeWithTag("atrio-support-toggle").performClick()
        compose.onNodeWithContentDescription("Recolher apoio").assertExists()
        compose.onNodeWithTag("atrio-support-edit").assertDoesNotExist()
        compose.onNodeWithTag("atrio-support-toggle").performClick()
        compose.onNodeWithContentDescription("Expandir apoio").assertExists()
    }

    @Test fun badgesAndEditorRemainUsableWithLargeText() {
        // Acessibilidade e navegação testadas apenas no projeto demo isolado.
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        val auth = FirebaseAuth.getInstance()
        auth.signOut()
        val uid = requireNotNull(Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user).uid
        try {
            compose.setContent {
                val density = LocalDensity.current.density
                CompositionLocalProvider(LocalDensity provides Density(density, 1.5f)) {
                    AtrioTheme {
                        OnlineProfileScreen(
                            db = FirebaseFirestore.getInstance(), uid = uid,
                            name = "Maria da Comunidade", email = "maria@example.test",
                            biography = "Uma caminhada de fé e comunidade.",
                            onSignOut = {},
                            onModeration = null, onClergyReview = null,
                            onOpen = {},
                            onNotifications = {}, onReviews = {}
                        )
                    }
                }
            }

            val list = compose.onNodeWithTag("atrio-profile-list")
            list.performScrollToNode(hasTestTag("atrio-profile-badges"))
            compose.onNodeWithTag("atrio-profile-badges").performClick()
            compose.onNodeWithText("Gerenciar selos").assertIsDisplayed()
            screenshot("04-selos-fonte-ampliada")
            compose.onNodeWithText("Voltar ao perfil").performClick()

            list.performScrollToNode(hasTestTag("atrio-profile-edit"))
            compose.onNodeWithTag("atrio-profile-edit").performClick()
            compose.onNodeWithTag("atrio-profile-name").assertIsDisplayed()
            val editor = compose.onNodeWithTag("atrio-profile-v3-editor")
            editor.performScrollToNode(hasTestTag("atrio-profile-bio"))
            compose.onNodeWithTag("atrio-profile-bio").performTextInput("Rascunho de apresentação")
            screenshot("05-editor-fonte-ampliada")
            editor.performScrollToNode(hasTestTag("atrio-profile-draft-preview"))
            compose.onNodeWithTag("atrio-profile-draft-preview").performClick()
            compose.onNodeWithText("Prévia · alterações não salvas").assertIsDisplayed()
            compose.onNodeWithTag("atrio-profile-draft-preview-bio")
                .assertTextContains("Rascunho de apresentação", substring = true)
            compose.onNodeWithText("Fechar prévia").performClick()
            editor.performScrollToNode(hasTestTag("atrio-profile-bio"))


            // A saída do editor não pode descartar silenciosamente um rascunho.
            compose.onNodeWithText("Cancelar").performClick()
            compose.onNodeWithText("Descartar alterações?").assertIsDisplayed()
            compose.onNodeWithText("Continuar editando").performClick()
            // O OutlinedTextField expõe rótulo/contador em Text e o rascunho em
            // EditableText. assertTextContains priorizava o rótulo, apesar de o
            // relatório provar que o rascunho estava preservado em EditableText.
            compose.onNodeWithTag("atrio-profile-bio").assert(
                SemanticsMatcher("rascunho permanece no campo editável") { node ->
                    runCatching {
                        node.config[SemanticsProperties.EditableText].text
                            .contains("Rascunho de apresentação")
                    }.getOrDefault(false)
                }
            )
            compose.onNodeWithText("Cancelar").performClick()
            compose.onNodeWithText("Descartar").performClick()
            compose.onNodeWithTag("atrio-profile-edit").assertExists()
        } finally {
            auth.signOut()
        }
    }

    @Test fun registrationWelcomeKeepsBothDestinationsAvailable() {
        var selected = ""
        compose.setContent {
            AtrioTheme {
                RegistrationWelcomeScreen(
                    onCreate = { selected = "create" },
                    onLogin = { selected = "login" }
                )
            }
        }
        compose.onNodeWithTag("atrio-welcome-create").assertExists().performClick()
        compose.runOnIdle { assertEquals("create", selected) }
        compose.onNodeWithTag("atrio-welcome-login").assertExists().performClick()
        compose.runOnIdle { assertEquals("login", selected) }
    }

    @Test fun optionalOnboardingCanBeSkippedWithoutChoosingReligion() {
        check(BuildConfig.DEBUG && FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        FirebaseAuth.getInstance().signOut()
        var finished = false
        compose.setContent {
            AtrioTheme {
                RegistrationOnboardingScreen(FirebaseFirestore.getInstance(),
                    uid = "qa-onboarding-skippable", onFinish = { finished = true })
            }
        }
        // Sem sessão nesta fixture, a leitura é recusada. O aviso entra
        // acima dos botões e altera a posição alvo durante a rolagem.
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("atrio-onboarding-info")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-onboarding-info").assertTextContains(
            "Não foi possível consultar suas preferências. Elas são opcionais."
        )
        compose.onNodeWithTag("atrio-onboarding-save").assertIsNotEnabled()

        val skip = compose.onNodeWithTag("atrio-onboarding-skip")
        skip.performScrollTo().assertIsDisplayed().assertIsEnabled()
        assertEquals(skip.getUnclippedBoundsInRoot(), skip.getBoundsInRoot())
        android.util.Log.i("AtrioOnboardingQA", "Pular visível após a resposta de preferências.")
        skip.performTouchInput { click() }

        val enter = compose.onNodeWithTag("atrio-onboarding-enter")
        enter.assertIsEnabled()
        skip.assertDoesNotExist()
        compose.onNodeWithTag("atrio-onboarding-save").assertDoesNotExist()
        enter.performScrollTo().assertIsDisplayed().performTouchInput { click() }
        compose.runOnIdle { assertEquals(true, finished) }
        android.util.Log.i("AtrioOnboardingQA", "Pular e Continuar concluídos por toque.")
    }


    @Test fun historyPagesTwentyAndLoadsAllTwentyOneFromEmulator() {
        check(BuildConfig.DEBUG && FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        check(BuildConfig.PUSH_RELAY_URL.isBlank())
        val auth = FirebaseAuth.getInstance()
        val db = FirebaseFirestore.getInstance()
        auth.signOut()
        try {
            val suffix = UUID.randomUUID().toString().take(12)
            val user = Tasks.await(
                auth.createUserWithEmailAndPassword("hist-$suffix@qa.invalid", "SenhaQA2026!NaoReal"),
                20, TimeUnit.SECONDS
            ).user ?: error("Conta de QA não foi criada")
            val uid = user.uid
            val author = "Histórico QA"
            Tasks.await(db.collection("profiles").document(uid).set(mapOf(
                "displayName" to author,
                "createdAt" to FieldValue.serverTimestamp()
            )), 15, TimeUnit.SECONDS)
            val ids = (1..21).map { number ->
                val ref = db.collection("posts").document()
                Tasks.await(ref.set(mapOf(
                    "uid" to uid,
                    "authorName" to author,
                    "title" to "Discussão de teste $number",
                    "body" to "Publicação de QA isolado para verificar a paginação do Perfil.",
                    "category" to "Vida espiritual",
                    "createdAt" to FieldValue.serverTimestamp()
                )), 15, TimeUnit.SECONDS)
                ref.id
            }
            compose.setContent {
                AtrioTheme {
                    ProfileDiscussionHistory(db, uid, onBack = {}, onOpen = null)
                }
            }
            val list = compose.onNodeWithTag("atrio-profile-history")
            compose.waitUntil(30_000) {
                runCatching {
                    compose.onNodeWithTag("atrio-history-count")
                        .assertTextEquals("20 discussões carregadas")
                    true
                }.getOrDefault(false)
            }
            list.performScrollToNode(hasTestTag("atrio-history-more"))
            compose.onNodeWithTag("atrio-history-more").assertIsDisplayed().performClick()
            compose.waitUntil(30_000) {
                runCatching {
                    list.performScrollToIndex(1)
                    compose.onNodeWithTag("atrio-history-count")
                        .assertTextEquals("21 discussões carregadas")
                    true
                }.getOrDefault(false)
            }
            // A primeira publicação é a mais antiga, mas deve continuar acessível.
            list.performScrollToNode(hasTestTag("atrio-history-item-${ids.first()}"))
            compose.onNodeWithTag("atrio-history-item-${ids.first()}").assertExists()
            // O piloto QA nao pode abrir detalhe/respostas da comunidade.
            compose.onNodeWithTag("atrio-history-item-${ids.first()}")
                .assert(!hasClickAction())
            list.performScrollToNode(hasTestTag("atrio-history-legacy-start"))
            compose.onNodeWithTag("atrio-history-legacy-start")
                .assertIsDisplayed().performClick()
            compose.waitUntil(30_000) {
                compose.onAllNodesWithTag("atrio-history-legacy-more")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            list.performScrollToNode(hasTestTag("atrio-history-legacy-more"))
            compose.onNodeWithTag("atrio-history-legacy-more").performClick()
            compose.waitUntil(30_000) {
                compose.onAllNodesWithTag("atrio-history-end")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            list.performScrollToNode(hasTestTag("atrio-history-end"))
            compose.onNodeWithTag("atrio-history-end").assertIsDisplayed()
            compose.onNodeWithTag("atrio-history-more").assertDoesNotExist()
        } finally {
            auth.signOut()
        }
    }

    @Test fun historyOffersRetryInsteadOfFalseEmptyStateWhenUnauthenticated() {
        check(BuildConfig.DEBUG && FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        FirebaseAuth.getInstance().signOut()
        compose.setContent {
            AtrioTheme {
                ProfileDiscussionHistory(
                    FirebaseFirestore.getInstance(), "qa-history-without-session",
                    onBack = {}, onOpen = {}
                )
            }
        }
        compose.waitUntil(20_000) {
            compose.onAllNodesWithTag("atrio-history-retry")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Nenhuma discussão encontrada nesta conta.").assertDoesNotExist()
        compose.onNodeWithTag("atrio-history-retry").assertIsDisplayed().performClick()
        compose.waitUntil(20_000) {
            compose.onAllNodesWithTag("atrio-history-retry")
                .fetchSemanticsNodes().isNotEmpty()
        }
    }


    @Test fun perfilQaOnlyOffersSignInAndNeverRegistration() {
        var emailSubmitted = ""
        var passwordSubmitted = ""
        compose.setContent {
            AtrioTheme {
                PerfilQaPilotContent(
                    state = PerfilQaScreenState.Login(),
                    onLogin = { email, password ->
                        emailSubmitted = email
                        passwordSubmitted = password
                    },
                    onSignOut = {}, onShowHistory = {}, onBack = {},
                    onSave = { _, _, _ -> },
                    history = {}
                )
            }
        }
        compose.onNodeWithTag("perfilqa-email").performTextInput("qa@example.test")
        compose.onNodeWithTag("perfilqa-password").performTextInput("SenhaSintetica123!")
        compose.onNodeWithTag("perfilqa-login").assertIsDisplayed().performClick()
        compose.runOnIdle {
            assertEquals("qa@example.test", emailSubmitted)
            assertEquals("SenhaSintetica123!", passwordSubmitted)
        }
        compose.onNodeWithText("Criar conta").assertDoesNotExist()
        compose.onNodeWithText("Publicar").assertDoesNotExist()
        compose.onNodeWithText("Conversas").assertDoesNotExist()
        compose.onNodeWithTag("atrio-profile-list").assertDoesNotExist()
    }

    @Test fun perfilQaOnlyOpensOwnReadOnlyHistoryWithLargeText() {
        var state by mutableStateOf<PerfilQaScreenState>(
            PerfilQaScreenState.Ready(
                uid = "qa-fake-only", email = "qa@example.test",
                displayName = "Pessoa de QA", bio = "Apresentação fictícia.",
                createdAt = Timestamp.now()
            )
        )
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.5f)) {
                AtrioTheme {
                    PerfilQaPilotContent(
                        state = state,
                        onLogin = { _, _ -> }, onSignOut = {},
                        onShowHistory = {
                            state = (state as PerfilQaScreenState.Ready).copy(history = true)
                        },
                        onBack = {
                            state = (state as PerfilQaScreenState.Ready).copy(history = false)
                        },
                        onSave = { _, _, _ -> },
                        history = {
                            androidx.compose.foundation.layout.Column {
                                androidx.compose.material3.Text("Histórico de QA somente leitura")
                                androidx.compose.material3.TextButton(
                                    onClick = {
                                        state = (state as PerfilQaScreenState.Ready)
                                            .copy(history = false)
                                    }
                                ) { androidx.compose.material3.Text("Voltar ao perfil QA") }
                            }
                        }
                    )
                }
            }
        }
        compose.onNodeWithTag("perfilqa-profile").assertExists()
        compose.onNodeWithTag("perfilqa-profile")
            .performScrollToNode(hasTestTag("perfilqa-history-open"))
        compose.onNodeWithTag("perfilqa-history-open").performClick()
        compose.onNodeWithText("Histórico de QA somente leitura").assertIsDisplayed()
        compose.onNodeWithText("Voltar ao perfil QA").performClick()
        compose.onNodeWithTag("perfilqa-profile").assertExists()
        compose.onNodeWithText("Minhas revisões").assertDoesNotExist()
        compose.onNodeWithText("Gerenciar selos").assertDoesNotExist()
        compose.onNodeWithText("Publicações salvas").assertDoesNotExist()
        compose.onNodeWithText("Abrir central de notificações").assertDoesNotExist()
    }

    @Test fun perfilQaEditsOnlyOwnNameAndBio() {
        var editedName = ""
        var editedBio = ""
        compose.setContent {
            AtrioTheme {
                PerfilQaPilotContent(
                    state = PerfilQaScreenState.Ready(
                        uid = "qa-fake-only", email = "qa@example.test",
                        displayName = "Pessoa de QA", bio = "Apresentação inicial.",
                        createdAt = Timestamp.now()
                    ),
                    onLogin = { _, _ -> }, onSignOut = {},
                    onShowHistory = {}, onBack = {},
                    onSave = { name, bio, done ->
                        editedName = name
                        editedBio = bio
                        done()
                    },
                    history = {}
                )
            }
        }
        compose.onNodeWithTag("perfilqa-profile")
            .performScrollToNode(hasTestTag("perfilqa-edit"))
        compose.onNodeWithTag("perfilqa-edit").performClick()
        compose.onNodeWithTag("perfilqa-name").performTextReplacement("Nome Autorizado")
        compose.onNodeWithTag("perfilqa-bio").performTextReplacement("Apresentação de teste.")
        compose.onNodeWithTag("perfilqa-save").performClick()
        compose.runOnIdle {
            assertEquals("Nome Autorizado", editedName)
            assertEquals("Apresentação de teste.", editedBio)
        }
        compose.onNodeWithTag("perfilqa-edit").assertExists()
        compose.onNodeWithTag("perfilqa-name").assertDoesNotExist()
    }

    private fun screenshot(name: String) {
        // O Gradle pode desinstalar o APK ao terminar a suíte. Guardar a captura
        // no diretório do shell de QA evita perdê-la junto com os dados do app.
        if (Build.VERSION.SDK_INT < 31) return
        require(name.matches(Regex("[a-z0-9-]+")))
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(
            automation.executeShellCommand("mkdir -p /data/local/tmp/atrio-profile-preview")
        ).use { it.readBytes() }
        // Captura pela automação Android: inclui diálogos, superfícies e selos
        // sem depender da captura Compose, que pode falhar no emulador de CI.
        val bitmap = automation.takeScreenshot()
            ?: error("O emulador Android não conseguiu capturar a tela")
        val pipes = automation.executeShellCommandRw("dd of=/data/local/tmp/atrio-profile-preview/$name.png")
        ParcelFileDescriptor.AutoCloseInputStream(pipes[0]).use { output ->
            ParcelFileDescriptor.AutoCloseOutputStream(pipes[1]).use { input ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, input))
            }
            output.readBytes()
        }
    }
}
