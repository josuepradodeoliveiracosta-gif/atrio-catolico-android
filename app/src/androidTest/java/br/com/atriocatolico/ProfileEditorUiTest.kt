package br.com.atriocatolico

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Exercita o editor real com persistência simulada, sem contas ou escritas remotas. */
class ProfileEditorUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun validatesNameAndPreventsDuplicateSave() {
        var writes = 0
        var saved = false
        var complete: ((Boolean) -> Unit)? = null
        compose.setContent {
            AtrioTheme {
                ProfileEditorDialog("one", "Maria", "", {},
                    onSave = { name, bio, callback ->
                        assertEquals("Maria Clara", name)
                        assertEquals("", bio)
                        writes++
                        complete = callback
                    }, onSaved = { saved = true })
            }
        }
        compose.onNodeWithTag("atrio-profile-save").assertIsNotEnabled()
        compose.onNodeWithTag("atrio-profile-name").performTextReplacement(" ")
        compose.onNodeWithTag("atrio-profile-save").assertIsNotEnabled()
        compose.onNodeWithTag("atrio-profile-name").performTextReplacement(" Maria Clara ")
        compose.onNodeWithTag("atrio-profile-save").performClick().assertIsNotEnabled()
        compose.onNodeWithText("Cancelar").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(1, writes); complete!!(true); assertTrue(saved) }
    }

    @Test fun failureKeepsDraftAndAllowsRetry() {
        compose.setContent {
            AtrioTheme {
                ProfileEditorDialog("one", "Maria", "", {},
                    onSave = { _, _, complete -> complete(false) })
            }
        }
        compose.onNodeWithTag("atrio-profile-bio").performTextInput("Minha caminhada")
        compose.onNodeWithTag("atrio-profile-save").performClick()
        compose.onNodeWithTag("atrio-profile-bio").assertTextContains("Minha caminhada")
        compose.onNodeWithText("Não foi possível salvar.", substring = true).assertExists()
        compose.onNodeWithTag("atrio-profile-save").assertIsEnabled()
    }

    @Test fun cancelRequiresConfirmationOnlyForUnsavedChanges() {
        var closed = false
        compose.setContent {
            AtrioTheme {
                ProfileEditorDialog("one", "Maria", "", { closed = true },
                    onSave = { _, _, _ -> error("Cancelar não deve salvar") })
            }
        }
        compose.onNodeWithTag("atrio-profile-bio").performTextInput("Rascunho")
        compose.onNodeWithText("Cancelar").performClick()
        compose.runOnIdle { assertFalse(closed) }
        compose.onNodeWithText("Continuar editando").performClick()
        compose.onNodeWithTag("atrio-profile-bio").assertTextContains("Rascunho")
        compose.onNodeWithText("Cancelar").performClick()
        compose.onNodeWithText("Descartar").performClick()
        compose.runOnIdle { assertTrue(closed) }
    }

    @Test fun accountChangeClearsDraftAndIgnoresOldSaveCompletion() {
        val account = mutableStateOf("one")
        var oldCompletion: ((Boolean) -> Unit)? = null
        var saved = false
        compose.setContent {
            AtrioTheme {
                ProfileEditorDialog(account.value, if (account.value == "one") "Maria" else "José", "", {},
                    onSave = { _, _, complete -> oldCompletion = complete }, onSaved = { saved = true })
            }
        }
        compose.onNodeWithTag("atrio-profile-bio").performTextInput("Texto da primeira conta")
        compose.onNodeWithTag("atrio-profile-save").performClick()
        compose.runOnIdle { account.value = "two" }
        compose.onNodeWithTag("atrio-profile-name").assertTextContains("José")
        compose.onNodeWithTag("atrio-profile-bio").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.runOnIdle { oldCompletion!!(true); assertFalse(saved) }
        compose.onNodeWithTag("atrio-profile-save").assertIsNotEnabled()
    }
}
