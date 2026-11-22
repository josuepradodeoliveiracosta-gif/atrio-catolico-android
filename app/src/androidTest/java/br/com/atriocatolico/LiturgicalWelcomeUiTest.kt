package br.com.atriocatolico

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import java.util.UUID
import org.junit.Rule
import org.junit.Test

class LiturgicalWelcomeUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun allContributionLevelsExposeTheirTrackAndLevel() {
        val tracks = mapOf("conversation" to "Conversas que acolhem",
            "helpful" to "Pessoa prestativa", "welcome" to "Portas abertas")
        var track by mutableStateOf("conversation")
        var level by mutableIntStateOf(1)
        compose.setContent { AtrioTheme { ContributionBadgeIcon(track, level, Modifier.size(52.dp)) } }
        for ((key, title) in tracks) {
            for (number in 1..5) {
                compose.runOnIdle { track = key; level = number }
                compose.onNodeWithContentDescription("$title, nível $number").assertIsDisplayed()
            }
        }
    }

    @Test fun hidingRemovesBannerOnlyForThatAccount() {
        val a = UUID.randomUUID().toString(); val b = UUID.randomUUID().toString()
        var account by mutableStateOf(a)
        var greeting by mutableStateOf("Bom dia")
        compose.setContent {
            AtrioTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
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
