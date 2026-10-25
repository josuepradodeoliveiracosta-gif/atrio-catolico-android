package br.com.atriocatolico

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Source

private data class BadgeState(val identity: String = "none", val layLabel: String = "none", val moderator: Boolean = false)
private data class BadgeSpec(val id: String, val title: String, val detail: String, val color: Color)
private val founderBadge = BadgeSpec("founder", "Fundador do Átrio", "Criador do aplicativo Átrio Católico. Este selo identifica a autoria do aplicativo; não representa autoridade religiosa.", Color(0xFF785412))
private val moderatorBadge = BadgeSpec("moderator", "Moderador", "Membro com acesso ativo à moderação e selo concedido pela administração.", Color(0xFF245B85))
private val priestBadge = BadgeSpec("priest", "Padre", "Identificação sacerdotal conferida e concedida pela administração do Átrio. O selo não concede poderes administrativos.", Wine)
private val deaconBadge = BadgeSpec("deacon", "Diácono", "Identificação diaconal conferida e concedida pela administração do Átrio. O selo não concede poderes administrativos.", Wine)
private fun badges(state: BadgeState, founder: Boolean): List<BadgeSpec> = buildList {
    if (founder) add(founderBadge)
    when (state.identity) {
        "priest" -> add(priestBadge)
        "deacon" -> add(deaconBadge)
        else -> when (state.layLabel) {
            "lay_man" -> add(BadgeSpec("lay", "Leigo", "Identificação opcional declarada pelo próprio membro.", Color(0xFF535B55)))
            "lay_woman" -> add(BadgeSpec("lay", "Leiga", "Identificação opcional declarada pelo próprio membro.", Color(0xFF535B55)))
        }
    }
    if (state.moderator) add(moderatorBadge)
}

/** Shared per signed-in session: repeated authors reuse the same two document listeners. */
private class BadgeDirectory(val db: FirebaseFirestore) {
    val states = mutableStateMapOf<String, BadgeState>()
    var founderUid by mutableStateOf("")
    private val refs = mutableMapOf<String, Int>()
    private val listeners = mutableMapOf<String, List<ListenerRegistration>>()
    fun acquire(uid: String) {
        refs[uid] = (refs[uid] ?: 0) + 1
        if (refs[uid] != 1) return
        states[uid] = BadgeState()
        val identity = db.collection("member_badges").document(uid).addSnapshotListener(MetadataChanges.INCLUDE) { doc, failure ->
            if (refs.containsKey(uid)) {
                val valid = failure == null && doc != null && !doc.metadata.isFromCache && !doc.metadata.hasPendingWrites()
                states[uid] = (states[uid] ?: BadgeState()).copy(
                    identity = if (valid) doc?.getString("identity") ?: "none" else "none",
                    layLabel = if (valid) doc?.getString("layLabel") ?: "none" else "none")
            }
        }
        val moderator = db.collection("moderator_badges").document(uid).addSnapshotListener(MetadataChanges.INCLUDE) { doc, failure ->
            if (refs.containsKey(uid)) states[uid] = (states[uid] ?: BadgeState()).copy(moderator =
                failure == null && doc != null && !doc.metadata.isFromCache && !doc.metadata.hasPendingWrites() && doc.getBoolean("enabled") == true)
        }
        listeners[uid] = listOf(identity, moderator)
    }
    fun release(uid: String) {
        val remaining = (refs[uid] ?: 1) - 1
        if (remaining > 0) refs[uid] = remaining else {
            refs.remove(uid); listeners.remove(uid)?.forEach { it.remove() }; states.remove(uid)
        }
    }
    fun close() { refs.clear(); listeners.values.flatten().forEach { it.remove() }; listeners.clear(); states.clear() }
}
private val LocalBadges = staticCompositionLocalOf<BadgeDirectory?> { null }

@Composable
internal fun BadgeProvider(db: FirebaseFirestore, uid: String, content: @Composable () -> Unit) {
    val directory = remember(db, uid) { BadgeDirectory(db) }
    DisposableEffect(directory) {
        var active = true
        val listener = db.document("app_config/community").addSnapshotListener(MetadataChanges.INCLUDE) { doc, failure ->
            if (active) directory.founderUid = if (failure == null && doc != null && !doc.metadata.isFromCache)
                (doc.data?.get("founderUid") as? String).orEmpty() else ""
        }
        onDispose { active = false; listener.remove(); directory.close() }
    }
    CompositionLocalProvider(LocalBadges provides directory, content = content)
}

@Composable
private fun memberState(uid: String): BadgeState {
    val directory = LocalBadges.current
    DisposableEffect(directory, uid) {
        if (uid.isNotBlank() && !uid.contains('/')) directory?.acquire(uid)
        onDispose { if (uid.isNotBlank()) directory?.release(uid) }
    }
    return directory?.states?.get(uid) ?: BadgeState()
}

@Composable
private fun BadgeIcon(spec: BadgeSpec) {
    when (spec.id) {
        "moderator" -> Icon(Icons.Outlined.Shield, null, Modifier.size(18.dp), tint = spec.color)
        "lay" -> Icon(Icons.Outlined.Groups, null, Modifier.size(18.dp), tint = spec.color)
        else -> Canvas(Modifier.size(18.dp)) {
            val w = size.width; val h = size.height; val stroke = 1.8.dp.toPx()
            fun line(x1: Float, y1: Float, x2: Float, y2: Float) = drawLine(spec.color,
                Offset(w*x1,h*y1), Offset(w*x2,h*y2), stroke, StrokeCap.Round)
            when (spec.id) {
                "founder" -> {
                    drawArc(spec.color, 180f, 180f, false, Offset(w*.16f,h*.32f), Size(w*.68f,h*.58f), style=Stroke(stroke))
                    line(.16f,.61f,.16f,.94f); line(.84f,.61f,.84f,.94f)
                    line(.5f,.02f,.5f,.28f); line(.38f,.12f,.62f,.12f)
                }
                "deacon" -> { line(.22f,.08f,.78f,.92f); line(.42f,.08f,.94f,.86f) }
                else -> { line(.5f,.08f,.5f,.94f); line(.18f,.36f,.82f,.36f) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MemberBadges(uid: String, expanded: Boolean = false) {
    val state = memberState(uid)
    val all = badges(state, uid.isNotBlank() && LocalBadges.current?.founderUid == uid)
    var details by remember(uid) { mutableStateOf(false) }
    if (all.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            (if (expanded) all else all.take(2)).forEach { spec ->
                Surface(onClick = { details = true }, color = spec.color.copy(alpha=.10f), shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.padding(vertical = 3.dp)) {
                    Row(Modifier.padding(horizontal=8.dp,vertical=7.dp), verticalAlignment=Alignment.CenterVertically,
                        horizontalArrangement=Arrangement.spacedBy(4.dp)) {
                        BadgeIcon(spec)
                        Text(spec.title, color=spec.color, fontSize=11.sp, fontWeight=FontWeight.SemiBold)
                    }
                }
            }
            if (!expanded && all.size > 2) TextButton(onClick={details=true}) { Text("+${all.size-2}") }
        }
    }
    if (details) AlertDialog(onDismissRequest={details=false}, title={Text("Selos do membro")}, text={
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement=Arrangement.spacedBy(12.dp)) {
            all.forEach { spec -> Text(spec.title, color=spec.color, fontWeight=FontWeight.Bold); Text(spec.detail) }
        }
    }, confirmButton={TextButton(onClick={details=false}){Text("Fechar")}})
}

@Composable
internal fun BadgeProfilePanel(uid: String, admin: Boolean) {
    val directory = LocalBadges.current ?: return
    val state = memberState(uid)
    val context = LocalContext.current
    var selfOpen by remember { mutableStateOf(false) }
    var adminOpen by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    MemberBadges(uid, expanded=true)
    TextButton(onClick={selfOpen=true}) { Text("Minha identificação na comunidade") }
    TextButton(onClick={
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("UID do Átrio",uid))
        copied=true
    }) { Text(if(copied) "UID copiado" else "Copiar meu UID") }
    if(admin) OutlinedButton(onClick={adminOpen=true}) { Text("Administrar selos") }
    if(selfOpen) LayIdentityDialog(directory.db,uid,state.identity,state.layLabel){selfOpen=false}
    if(adminOpen && admin) BadgeAdminDialog(directory.db,uid){adminOpen=false}
}

@Composable
private fun LayIdentityDialog(db: FirebaseFirestore, uid: String, identity: String, current: String, close: () -> Unit) {
    var selected by remember { mutableStateOf(current) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val cleric = identity == "priest" || identity == "deacon"
    AlertDialog(onDismissRequest={if(!busy)close()},title={Text("Minha identificação")},text={
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Text(if(cleric) "Seu selo de Padre ou Diácono é administrado pela equipe. Solicite a ela qualquer correção."
                else "Escolha opcional e pública. Leigo/Leiga é uma identificação autodeclarada; você pode removê-la a qualquer momento.")
            if(!cleric) listOf("none" to "Não exibir", "lay_man" to "Leigo", "lay_woman" to "Leiga").forEach { (value,label) ->
                Row(verticalAlignment=Alignment.CenterVertically) {
                    RadioButton(selected==value,{selected=value},enabled=!busy); Text(label)
                }
            }
            if(error.isNotBlank()) Text(error,color=MaterialTheme.colorScheme.error)
        }
    },confirmButton={if(!cleric)TextButton(enabled=!busy,onClick={
        busy=true;error=""
        val ref=db.collection("member_badges").document(uid)
        db.runTransaction { tx ->
            val doc=tx.get(ref)
            check((doc.getString("identity") ?: "none") == "none") { "A administração atualizou seu selo. Reabra esta tela." }
            if(doc.exists()) tx.update(ref,"layLabel",selected)
            else tx.set(ref,mapOf("identity" to "none","layLabel" to selected))
            true
        }.addOnCompleteListener { task -> busy=false; if(task.isSuccessful)close() else error="Não foi possível salvar. Confira a conexão e as regras de selos; reabra se seu selo mudou." }
    }){Text(if(busy)"Salvando…" else "Salvar")}},dismissButton={TextButton(enabled=!busy,onClick=close){Text("Fechar")}})
}

@Composable
private fun BadgeAdminDialog(db: FirebaseFirestore, ownUid: String, close: () -> Unit) {
    var target by remember { mutableStateOf(ownUid) }
    var loadedUid by remember { mutableStateOf("") }
    var identity by remember { mutableStateOf("none") }
    var verified by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf<String?>(null) }
    fun save(action: String) {
        busy=true; message=""
        val task = if(action=="identity") db.collection("member_badges").document(loadedUid)
            .set(mapOf("identity" to identity, "layLabel" to "none"),SetOptions.merge())
        else db.collection("moderator_badges").document(loadedUid).set(mapOf("enabled" to (action=="moderator_on")))
        task.addOnCompleteListener { result ->
            busy=false;confirm=null
            message=if(result.isSuccessful) "Alteração salva. Os selos serão atualizados com a sincronização."
                else "Não foi possível salvar. Confira as regras, sua permissão e, para Moderador, se a conta tem admins/UID com enabled=true."
        }
    }
    AlertDialog(onDismissRequest={if(!busy)close()},title={Text("Administrar selos")},text={
        Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Text("Use o UID fornecido pelo membro em seu perfil. Confira a conta antes de conceder qualquer selo.")
            OutlinedTextField(target,{target=it.trim().take(128);loadedUid="";verified=false;message=""},enabled=!busy,
                label={Text("UID do membro")},singleLine=true)
            TextButton(enabled=!busy && target.isNotBlank() && !target.contains('/'),onClick={
                busy=true;message="";val requested=target
                db.collection("member_badges").document(requested).get(Source.SERVER).addOnCompleteListener { task ->
                    busy=false
                    if(task.isSuccessful) { loadedUid=requested;identity=task.result.getString("identity") ?: "none";verified=false }
                    else message="Não foi possível consultar. Publique as regras de selos e confira sua conexão."
                }
            }){Text(if(busy)"Aguarde…" else "Carregar selos")}
            if(loadedUid.isNotBlank()) {
                Text("Conta selecionada: $loadedUid",fontSize=12.sp)
                Text("Identificação verificada",fontWeight=FontWeight.Bold)
                listOf("none" to "Sem selo clerical", "priest" to "Padre", "deacon" to "Diácono").forEach { (value,label) ->
                    Row(verticalAlignment=Alignment.CenterVertically) { RadioButton(identity==value,{identity=value;verified=false},enabled=!busy);Text(label) }
                }
                if(identity!="none") Row(verticalAlignment=Alignment.CenterVertically) {
                    Checkbox(verified,{verified=it},enabled=!busy)
                    Text("Conferi a identidade e a condição de padre ou diácono deste membro.",fontSize=12.sp)
                }
                Button(enabled=!busy && (identity=="none" || verified),onClick={confirm="identity"}) { Text("Salvar identificação") }
                HorizontalDivider()
                Text("O selo de Moderador exige acesso administrativo já ativo. Este painel não concede esse acesso.",fontSize=12.sp)
                TextButton(enabled=!busy,onClick={confirm="moderator_on"}){Text("Conceder selo Moderador")}
                TextButton(enabled=!busy,onClick={confirm="moderator_off"}){Text("Retirar selo Moderador")}
                Text("O selo de Fundador é exclusivo do UID definido pelo proprietário do projeto no Firebase.",fontSize=12.sp,color=Muted)
            }
            if(message.isNotBlank()) Text(message,color=Wine)
        }
    },confirmButton={TextButton(enabled=!busy,onClick=close){Text("Fechar")}})
    val action=confirm
    if(action!=null) AlertDialog(onDismissRequest={if(!busy)confirm=null},title={Text("Confirmar alteração")},
        text={Text("UID: $loadedUid\n\n"+when(action){
            "identity" -> "Identificação: ${when(identity){"priest"->"Padre";"deacon"->"Diácono";else->"Sem selo clerical"}}. A identificação Leigo/Leiga anterior será limpa; o membro poderá escolhê-la novamente quando estiver sem selo clerical."
            "moderator_on" -> "Conceder selo Moderador, sem alterar permissões."
            else -> "Retirar o selo Moderador. Isso não revoga o acesso à moderação; para revogá-lo, altere admins/UID no Console."
        })},confirmButton={TextButton(enabled=!busy,onClick={save(action)}){Text(if(busy)"Salvando…" else "Confirmar")}},
        dismissButton={TextButton(enabled=!busy,onClick={confirm=null}){Text("Cancelar")}})
}
