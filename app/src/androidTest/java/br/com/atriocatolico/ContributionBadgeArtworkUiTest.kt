package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ContributionBadgeArtworkUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun artworkExposesTrackAndEarnedLevelWithoutRelyingOnColor() {
        compose.setContent {
            Row {
                ContributionBadgeIcon("conversation", 1, Modifier.size(52.dp))
                ContributionBadgeIcon("helpful", 5, Modifier.size(52.dp))
                ContributionBadgeIcon("welcome", 1, Modifier.size(58.dp), earned = false)
            }
        }
        compose.onNodeWithContentDescription("Conversas que acolhem, nível 1").assertIsDisplayed()
        compose.onNodeWithContentDescription("Pessoa prestativa, nível 5").assertIsDisplayed()
        compose.onNodeWithContentDescription(
            "Insígnia de Portas abertas, ainda não conquistada"
        ).assertIsDisplayed()
    }
}
