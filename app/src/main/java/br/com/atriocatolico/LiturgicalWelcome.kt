package br.com.atriocatolico

import android.content.Context
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import br.com.atriocatolico.LiturgicalCalendarBR.Season

/** Empty key is reserved for the offline demo; Firebase accounts always use the actual UID. */
@Composable
internal fun welcomePreference(uid: String): MutableState<Boolean> {
    val context = LocalContext.current
    val prefs = remember(context) { context.getSharedPreferences("atrio.appearance", Context.MODE_PRIVATE) }
    val key = if (uid.isEmpty()) "demo.welcome" else "account.$uid.welcome"
    val state = remember(key,prefs) { mutableStateOf(prefs.getBoolean(key,true)) }
    DisposableEffect(key,prefs) {
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, changed ->
            if (changed == key || changed == null) state.value = prefs.getBoolean(key,true)
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        state.value = prefs.getBoolean(key,true)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return remember(key,prefs,state) { object : MutableState<Boolean> {
        override var value: Boolean
            get() = state.value
            set(v) { prefs.edit().putBoolean(key,v).apply(); state.value = v }
        override fun component1() = value
        override fun component2(): (Boolean) -> Unit = { value = it }
    } }
}

@Composable
internal fun AppearanceSettings(uid: String) {
    val day = LocalLiturgicalDay.current
    var visible by welcomePreference(uid)
    Card(modifier = Modifier.fillMaxWidth().testTag("atrio-appearance")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Aparência", style = MaterialTheme.typography.titleLarge)
            Text("Tema litúrgico", style = MaterialTheme.typography.labelLarge)
            Text(if (day.season == Season.ATRIO) day.season.title else "${day.season.title} · automático")
            if (day.feast.isNotEmpty()) Text(day.feast)
            Text("Modo de exibição", style = MaterialTheme.typography.labelLarge)
            Text("Conforme o sistema · ${if (isSystemInDarkTheme()) "escuro" else "claro"}")
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = visible, role = Role.Switch,
                onValueChange = { visible = it }), verticalAlignment = Alignment.CenterVertically) {
                Text("Mostrar boas-vindas", Modifier.weight(1f)); Switch(checked = visible, onCheckedChange = null)
            }
            if (BuildConfig.BUILD_TYPE == "qaGeral") HolyWeekPreview()
        }
    }
}

@Composable
internal fun LiturgicalWelcome(name: String, day: LiturgicalCalendarBR.Day = LocalLiturgicalDay.current,
                              greeting: String = LocalGreeting.current, qaCaption: String? = null) {
    val art = when(day.season) {
        Season.ADVENT -> R.drawable.liturgy_advent
        Season.CHRISTMAS -> R.drawable.liturgy_christmas
        Season.ORDINARY -> R.drawable.liturgy_ordinary
        Season.LENT -> R.drawable.liturgy_lent
        Season.TRIDUUM -> R.drawable.liturgy_triduum
        Season.EASTER -> R.drawable.liturgy_easter
        else -> null
    }
    val first = name.trim().substringBefore(' ')
    val message = qaCaption ?: when(day.feast) {
        "Quinta-feira Santa" -> "Permaneçamos com Cristo em oração."
        "Sábado Santo" -> "No silêncio, aguardamos a Ressurreição."
        else -> day.season.message
    }
    Card(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}.testTag("atrio-welcome"),
        colors = CardDefaults.cardColors(containerColor = WineSoft, contentColor = Wine)) {
        art?.let { resource -> Image(painterResource(resource), contentDescription = null,
            contentScale = ContentScale.FillBounds,
            modifier = Modifier.fillMaxWidth().aspectRatio(768f / 341f).drawWithContent {
                drawContent()
                if (day.candles > 1) {
                    val w = size.width/768; val h = size.height/341
                    for ((x,y) in listOf(360 to 110,461 to 110,558 to 96).take(day.candles-1)) {
                        drawOval(Color(0xFFFFBB45), Offset((x-11)*w,(y-31)*h), Size(22*w,34*h))
                        drawOval(Color(0xFFFFF7D1), Offset((x-5)*w,(y-18)*h), Size(10*w,21*h))
                    }
                }
                val dim = if (day.feast=="Sábado Santo") .54f else if (greeting=="Boa noite") .32f else if (greeting=="Boa tarde") .12f else 0f
                drawRect(Color.Black.copy(alpha = dim))
            }) }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(if (first.isBlank()) "$greeting!" else "$greeting, $first!", style = MaterialTheme.typography.headlineSmall)
            Text(message)
            if(day.season != Season.ATRIO) Text(listOf(day.season.title,day.feast).filter(String::isNotBlank).joinToString(" · "),
                style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** Local QA only: never changes the civil calendar or persists a simulated celebration. */
@Composable
private fun HolyWeekPreview() {
    var scene by remember { mutableStateOf(0) }
    TextButton(onClick = { scene = (scene + 1) % 3 }) {
        Text(when(scene) { 0 -> "Prévia QA: Ceia do Senhor"; 1 -> "Prévia QA: Vigília Pascal"; else -> "Fechar prévia" })
    }
    if (scene != 0) {
        val vigil = scene == 2
        val day = remember(vigil) { LiturgicalCalendarBR.Day(if (vigil) Season.EASTER else Season.TRIDUUM,
            if (vigil) "Vigília Pascal" else "Ceia do Senhor", false, 0) }
        MaterialTheme(colorScheme = liturgicalColors(day,isSystemInDarkTheme())) {
            LiturgicalWelcome("",day,"Boa noite",if (vigil) "A luz de Cristo ilumina esta noite." else "Recordemos a Ceia do Senhor.")
        }
    }
}
