package br.com.atriocatolico

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import java.util.UUID
import org.junit.Rule
import org.junit.Test

class LiturgicalWelcomeUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun hidingRemovesBannerOnlyForThatAccount() {
        val a = UUID.randomUUID().toString(); val b = UUID.randomUUID().toString()
        var account by mutableStateOf(a)
        var greeting by mutableStateOf("Bom dia")
        compose.setContent {
            AtrioTheme {
                Column {
                    AppearanceSettings(account)
                    if (welcomePreference(account).value) LiturgicalWelcome("",greeting = greeting)
                }
            }
        }
        compose.onNodeWithText("Bom dia!").assertExists()
        compose.onNodeWithText("Mostrar boas-vindas").performClick()
        compose.onNodeWithTag("atrio-welcome").assertDoesNotExist()
        compose.runOnIdle { account = b; greeting = "Boa tarde" }
        compose.onNodeWithText("Boa tarde!").assertExists()
        compose.runOnIdle { account = a }
        compose.onNodeWithTag("atrio-welcome").assertDoesNotExist()
        compose.onNodeWithText("Tema litúrgico").assertExists()
    }
}
