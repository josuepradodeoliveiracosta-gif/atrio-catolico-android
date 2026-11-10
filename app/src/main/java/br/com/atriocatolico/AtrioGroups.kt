package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import java.text.DateFormat

/** Grupos privados. Nunca usar a interface como única barreira de acesso. */
internal object AtrioGroupPolicy {
    const val VERSION = "2026-11-groups-v1"
    const val MAX_MEMBERS = 8 // Provisório, exige aprovação antes do rollout.
    fun eligibleTitle(title: String): Boolean = title == title.trim() &&
        title.length in 5..80 && title.none { it.isISOControl() }
    fun categoryName(category: String): String = when (category) {
        "study" -> "Estudo"
        "prayer" -> "Oração"
        else -> "Comunidade"
    }
}


/**
 * Os snapshots de convites e membros chegam por listeners independentes.
 * Durante o aceite, o mesmo groupId pode existir nas duas seções por instantes.
 * Compose exige chaves únicas em toda a LazyColumn, não apenas em cada seção.
 */
internal object AtrioGroupListKeys {
    fun invitation(groupId: String): String = "invite:$groupId"
    fun membership(groupId: String): String = "room:$groupId"
}

private data class AtrioGroup(
    val id: String,
    val name: String,
    val category: String,
    val owner: String,
    val memberUids: List<String>,
    val adminUids: List<String>,
    val preview: String,
    val lastMessageId: String,
    val status: String
)
private data class AtrioGroupInvite(
    val id: String,
    val groupId: String,
    val name: String,
    val inviter: String,
    val status: String
)
private data class AtrioGroupMessage(
    val id: String, val sender: String, val text: String, val sentAt: Long,
    val pending: Boolean
)

private fun DocumentSnapshot.asAtrioGroup(): AtrioGroup? {
    val owner=getString("ownerUid") ?: return null
    val members=(get("memberUids") as? List<*>)?.filterIsInstance<String>().orEmpty()
    val admins=(get("adminUids") as? List<*>)?.filterIsInstance<String>().orEmpty()
    return AtrioGroup(id,getString("name").orEmpty(),
        getString("category").orEmpty(),owner,members,admins,
        getString("lastPreview").orEmpty(),getString("lastMessageId").orEmpty(),
        getString("status").orEmpty())
}

@Composable
private fun groupPeerName(db: FirebaseFirestore, uid: String): String {
    var name by remember(uid) { mutableStateOf("Participante") }
    DisposableEffect(db,uid) {
        val listener=db.collection("public_profiles").document(uid)
            .addSnapshotListener { snapshot, error ->
                if (error == null) name=snapshot?.getString("displayName")
                    ?.takeIf { it.isNotBlank() } ?: "Participante"
            }
        onDispose { listener.remove() }
    }
    return name
}

@Composable
internal fun AtrioGroupsScreen(
    db: FirebaseFirestore,
    uid: String,
    knownPeers: List<String>,
    onBack: () -> Unit,
    initialGroupId: String? = null
) {
    var configLoaded by remember(uid) { mutableStateOf(false) }
    var enabled by remember(uid) { mutableStateOf(false) }
    var pushEnabled by remember(uid) { mutableStateOf(false) }
    var accessLoaded by remember(uid) { mutableStateOf(false) }
    var accessApproved by remember(uid) { mutableStateOf(false) }
    var accessValidUntil by remember(uid) { mutableLongStateOf(0L) }
    var rooms by remember(uid) { mutableStateOf<List<AtrioGroup>>(emptyList()) }
    var invitations by remember(uid) { mutableStateOf<List<AtrioGroupInvite>>(emptyList()) }
    var selectedId by remember(uid,initialGroupId) { mutableStateOf(initialGroupId) }
    var createOpen by remember(uid) { mutableStateOf(false) }
    var title by remember(uid) { mutableStateOf("") }
    var category by remember(uid) { mutableStateOf("study") }
    var busy by remember(uid) { mutableStateOf(false) }
    var info by remember(uid) { mutableStateOf("") }

    // Sair de uma conta cancela consultas de grupos, convites e elegibilidade
    // antes que a Activity seja obrigatoriamente destruída.
    val authentication = remember { FirebaseAuth.getInstance() }
    var activeAuthUid by remember(uid) {
        mutableStateOf(authentication.currentUser?.uid)
    }
    DisposableEffect(authentication, uid) {
        val observer = FirebaseAuth.AuthStateListener { instance ->
            activeAuthUid = instance.currentUser?.uid
        }
        authentication.addAuthStateListener(observer)
        onDispose { authentication.removeAuthStateListener(observer) }
    }
    val ownSession = activeAuthUid == uid &&
        authentication.currentUser?.uid == uid

    DisposableEffect(db, uid, ownSession) {
        if (!ownSession) {
            configLoaded = false
            enabled = false
            pushEnabled = false
            accessLoaded = false
            accessApproved = false
            rooms = emptyList()
            invitations = emptyList()
            onDispose {}
        } else {
        val listener=db.document("app_config/chat_groups")
            .addSnapshotListener { data,error ->
                configLoaded=true
                enabled=error==null && data?.getBoolean("enabled")==true &&
                    data.getBoolean("minorPolicyApproved")==true &&
                    data.getString("version")==AtrioGroupPolicy.VERSION
                pushEnabled=enabled && data?.getBoolean("pushEnabled")==true
            }
        onDispose { listener.remove() }
        }
    }
    DisposableEffect(db,uid,enabled,ownSession) {
        if(!enabled || !ownSession) {
            accessLoaded=false
            accessApproved=false
            accessValidUntil=0L
            onDispose {}
        } else {
            accessLoaded=false
            val watcher=db.collection("users").document(uid)
                .collection("chatGroupAccess").document("eligibility")
                .addSnapshotListener { snapshot,failure ->
                    accessLoaded=true
                    accessValidUntil=if(failure==null)
                        snapshot?.getTimestamp("reviewExpiresAt")?.toDate()?.time ?: 0L
                        else 0L
                    accessApproved=failure==null &&
                        snapshot?.getString("status")=="approved" &&
                        snapshot.getString("policyVersion")=="2026-11-group-safety-v1" &&
                        accessValidUntil>System.currentTimeMillis()
                    if(!accessApproved) {
                        rooms=emptyList()
                        invitations=emptyList()
                        selectedId=null
                    }
                }
            onDispose { watcher.remove() }
        }
    }
    // Interface fecha ao expirar; Firestore não confia no relógio do aparelho.
    LaunchedEffect(uid,accessValidUntil) {
        if(accessValidUntil>0L) {
            kotlinx.coroutines.delay((accessValidUntil-System.currentTimeMillis())
                .coerceAtLeast(0L))
            if(System.currentTimeMillis()>=accessValidUntil) {
                accessApproved=false
                rooms=emptyList()
                invitations=emptyList()
                selectedId=null
            }
        }
    }
    DisposableEffect(db,uid,enabled,accessApproved,ownSession) {
        if (!enabled || !accessApproved || !ownSession) {
            rooms=emptyList()
            onDispose {}
        } else {
            val listener=db.collection("chat_groups")
                .whereArrayContains("memberUids",uid).limit(50)
                .addSnapshotListener { data,error ->
                    if (error==null) rooms=data?.documents
                        ?.mapNotNull { it.asAtrioGroup() }.orEmpty()
                    else info="Falha ao consultar os grupos privados."
                }
            onDispose { listener.remove() }
        }
    }
    DisposableEffect(db,uid,enabled,accessApproved,ownSession) {
        if (!enabled || !accessApproved || !ownSession) {
            invitations=emptyList()
            onDispose {}
        } else {
            val listener=db.collectionGroup("atrioGroupInvites")
                .whereEqualTo("inviteeUid",uid).limit(100)
                .addSnapshotListener { data,error ->
                    if (error==null) invitations=data?.documents.orEmpty()
                        .mapNotNull { snap ->
                            val groupId=snap.reference.parent.parent?.id ?: return@mapNotNull null
                            AtrioGroupInvite(snap.id,groupId,
                                snap.getString("groupName").orEmpty(),
                                snap.getString("inviterUid").orEmpty(),
                                snap.getString("status").orEmpty())
                        }
                    else info="Convites não disponíveis. Verifique a conexão ou os índices."
                }
            onDispose { listener.remove() }
        }
    }

    fun createGroup() {
        val proposed=title.trim()
        if (busy || FirebaseAuth.getInstance().currentUser?.uid!=uid ||
            !AtrioGroupPolicy.eligibleTitle(proposed)) {
            info="Informe um nome de 5 a 80 caracteres."
            return
        }
        busy=true
        val ref=db.collection("chat_groups").document()
        val quotaRef=db.collection("users").document(uid)
            .collection("chatGroupLimits").document("creation")
        db.runTransaction { tx ->
            val previous=tx.get(quotaRef)
            val start=previous.getTimestamp("windowStart")
            val reset=start==null ||
                System.currentTimeMillis()-start.toDate().time>=86_400_000L
            val count=if (reset) 1L else (previous.getLong("count") ?: 0L)+1L
            check(count<=2L) { "Limite provisório de grupos atingido" }
            tx.set(quotaRef,mapOf(
                "count" to count,
                "windowStart" to if (reset) FieldValue.serverTimestamp() else start!!,
                "updatedAt" to FieldValue.serverTimestamp(),
                "lastGroupId" to ref.id))
            tx.set(ref,mapOf(
                "name" to proposed,"category" to category,
                "ownerUid" to uid,
                "memberUids" to listOf(uid),"adminUids" to listOf(uid),
                "status" to "active",
                "createdAt" to FieldValue.serverTimestamp(),
                "updatedAt" to FieldValue.serverTimestamp(),
                "lastMessageId" to "","lastPreview" to "","lastSenderUid" to ""))
            true
        }.addOnCompleteListener { result ->
            busy=false
            if(result.isSuccessful) {
                createOpen=false
                title=""
                info="Grupo privado criado."
                selectedId=ref.id
            } else info="Não foi possível criar o grupo. Confira sua quota e suas permissões."
        }
    }

    fun respond(invite: AtrioGroupInvite,accept: Boolean) {
        if (busy || !enabled) return
        busy=true
        val inviteRef=db.collection("chat_groups").document(invite.groupId)
            .collection("atrioGroupInvites").document(uid)
        if (!accept) {
            inviteRef.update("status","declined",
                "updatedAt",FieldValue.serverTimestamp())
                .addOnCompleteListener { result ->
                    busy=false
                    info=if(result.isSuccessful) "Convite recusado."
                        else "Não foi possível recusar o convite."
                }
        } else {
            val groupRef=db.collection("chat_groups").document(invite.groupId)
            val batch=db.batch()
            batch.update(inviteRef,"status","accepted",
                "updatedAt",FieldValue.serverTimestamp())
            batch.update(groupRef,"memberUids",FieldValue.arrayUnion(uid),
                "updatedAt",FieldValue.serverTimestamp())
            batch.commit().addOnCompleteListener { result ->
                busy=false
                if(result.isSuccessful) {
                    info="Convite aceito."
                    selectedId=invite.groupId
                } else info="Entrada não autorizada ou grupo completo."
            }
        }
    }

    BackHandler { if(selectedId!=null) selectedId=null else onBack() }
    val selected=rooms.firstOrNull { it.id==selectedId }
    Column(Modifier.fillMaxSize().background(Paper).testTag("atrio-groups-screen")) {
        if (!ownSession) {
            Text("Sua sessão mudou. Entre novamente.",Modifier.padding(20.dp))
        } else if (!configLoaded) {
            CircularProgressIndicator(Modifier.padding(24.dp))
        } else if (!enabled) {
            Column(Modifier.padding(22.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("Grupos do Átrio",color=Wine,
                    style=MaterialTheme.typography.headlineSmall)
                Text("Grupos privados de estudo, oração e comunidade estão em preparação. " +
                    "A abertura depende da política de proteção de menores e da homologação.")
                OutlinedButton(onClick=onBack) { Text("Voltar às conversas") }
            }
        } else if(!accessLoaded) {
            CircularProgressIndicator(Modifier.padding(24.dp))
        } else if(!accessApproved) {
            Column(Modifier.padding(22.dp),
                verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("Acesso aos grupos indisponível para esta conta",
                    color=Wine,style=MaterialTheme.typography.titleMedium)
                Text("A participação exige aprovação individual pela administração " +
                    "e regras de proteção previamente homologadas. " +
                    "Este estado não informa idade nem dados privados de ninguém.")
                OutlinedButton(onClick=onBack) { Text("Voltar às conversas") }
            }
        } else if(selectedId!=null && selected!=null) {
            AtrioGroupThread(db,uid,selected,knownPeers,
                pushEnabled=pushEnabled,
                onBack={ selectedId=null })
        } else if(selectedId!=null) {
            Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("Este grupo não está disponível para esta conta.")
                OutlinedButton(onClick={ selectedId=null }) { Text("Voltar") }
            }
        } else {
            Row(Modifier.fillMaxWidth().padding(12.dp),
                verticalAlignment=Alignment.CenterVertically) {
                TextButton(onClick=onBack) { Text("Voltar") }
                Text("Grupos do Átrio",color=Wine,
                    fontSize=20.sp,fontWeight=FontWeight.Bold,
                    modifier=Modifier.weight(1f))
                TextButton(onClick={createOpen=!createOpen},
                    modifier=Modifier.testTag("atrio-group-create-open")) {
                    Text(if(createOpen) "Cancelar" else "Criar")
                }
            }
            if(info.isNotBlank()) Text(info,Modifier.padding(horizontal=16.dp),
                color=Muted,fontSize=13.sp)
            if(createOpen) {
                Column(Modifier.fillMaxWidth().padding(12.dp),
                    verticalArrangement=Arrangement.spacedBy(7.dp)) {
                    OutlinedTextField(title,{ if(it.length<=80) title=it },
                        label={Text("Nome do grupo")},singleLine=true,
                        modifier=Modifier.fillMaxWidth().testTag("atrio-group-title"))
                    Column(verticalArrangement=Arrangement.spacedBy(2.dp)) {
                        Text("Finalidade do grupo",fontWeight=FontWeight.SemiBold,
                            fontSize=14.sp,color=Wine)
                        listOf("study","prayer","community").forEach { option ->
                            Row(verticalAlignment=Alignment.CenterVertically) {
                                RadioButton(selected=category==option,
                                    onClick={category=option})
                                Text(AtrioGroupPolicy.categoryName(option),
                                    fontSize=14.sp)
                            }
                        }
                    }
                    Text("Grupo fechado: apenas convidados podem entrar. " +
                        "Limites provisórios de 8 membros e 2 grupos por dia.",
                        color=Muted,fontSize=12.sp)
                    Button(onClick={createGroup()},enabled=!busy && title.trim().length in 5..80,
                        modifier=Modifier.fillMaxWidth().testTag("atrio-group-create")) {
                        Text("Criar grupo privado")
                    }
                }
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(),
                contentPadding=PaddingValues(12.dp),
                verticalArrangement=Arrangement.spacedBy(8.dp)) {
                val pending=invitations.filter { it.status=="pending" }
                if(pending.isNotEmpty()) item {
                    Text("Convites recebidos",color=Wine,
                        fontSize=17.sp,fontWeight=FontWeight.SemiBold)
                }
                items(pending,key={AtrioGroupListKeys.invitation(it.groupId)}) { invite ->
                    Card(colors=CardDefaults.cardColors(
                        containerColor=MaterialTheme.colorScheme.surface),
                        border=BorderStroke(1.dp,Line)) {
                        Column(Modifier.padding(14.dp),
                            verticalArrangement=Arrangement.spacedBy(7.dp)) {
                            Text(invite.name,fontWeight=FontWeight.SemiBold)
                            val inviterName=groupPeerName(db,invite.inviter)
                            Text("Convite enviado por " + inviterName +
                                ". Aceitar é opcional.",
                                color=Muted,fontSize=12.sp)
                            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                Button(onClick={respond(invite,true)},enabled=!busy,
                                    modifier=Modifier.testTag("atrio-group-accept-"+invite.groupId)) {
                                    Text("Aceitar")
                                }
                                OutlinedButton(onClick={respond(invite,false)},enabled=!busy) {
                                    Text("Recusar")
                                }
                            }
                        }
                    }
                }
                item {
                    Text("Meus grupos",color=Wine,
                        fontSize=17.sp,fontWeight=FontWeight.SemiBold)
                }
                if(rooms.isEmpty()) item {
                    Text("Você ainda não participa de grupos.",
                        color=Muted,modifier=Modifier.padding(8.dp))
                }
                items(rooms,key={AtrioGroupListKeys.membership(it.id)}) { room ->
                    Card(onClick={selectedId=room.id},
                        modifier=Modifier.fillMaxWidth().testTag("atrio-group-"+room.id),
                        colors=CardDefaults.cardColors(
                            containerColor=MaterialTheme.colorScheme.surface),
                        border=BorderStroke(1.dp,Line),
                        shape=RoundedCornerShape(16.dp)) {
                        Column(Modifier.padding(15.dp),
                            verticalArrangement=Arrangement.spacedBy(6.dp)) {
                            Text(room.name,fontWeight=FontWeight.Bold)
                            Text(AtrioGroupPolicy.categoryName(room.category) +
                                " • " + room.memberUids.size + "/" +
                                AtrioGroupPolicy.MAX_MEMBERS + " participantes",
                                fontSize=13.sp,color=Muted)
                            if(room.status=="closed")
                                Text("Encerrado • histórico somente leitura",
                                    fontSize=13.sp,color=Muted)
                            else
                                Text(room.preview.ifBlank { "Nenhuma mensagem ainda." },
                                    maxLines=2,overflow=TextOverflow.Ellipsis,color=Muted)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AtrioGroupThread(
    db: FirebaseFirestore,uid: String,room: AtrioGroup,
    knownPeers: List<String>,pushEnabled: Boolean,onBack: () -> Unit
) {
    val roomRef=remember(db,room.id) { db.collection("chat_groups").document(room.id) }
    val context=LocalContext.current
    var muted by remember(uid,room.id) { mutableStateOf(false) }
    DisposableEffect(uid,room.id) {
        AtrioGroupForeground.open(uid,room.id)
        onDispose { AtrioGroupForeground.close(uid,room.id) }
    }
    DisposableEffect(db,uid,room.id) {
        val listener=db.collection("users").document(uid)
            .collection("chatGroupBox").document(room.id)
            .addSnapshotListener { snapshot,failure ->
                if(failure==null) {
                    muted=snapshot?.getBoolean("muted")==true
                    context.getSharedPreferences("atrio_group_muted_"+uid,
                        android.content.Context.MODE_PRIVATE)
                        .edit().putBoolean(room.id,muted).apply()
                }
            }
        onDispose { listener.remove() }
    }
    var draft by remember(uid,room.id) { mutableStateOf("") }
    var pendingId by remember(uid,room.id) { mutableStateOf("") }
    var pendingText by remember(uid,room.id) { mutableStateOf("") }
    LaunchedEffect(room.lastMessageId,pendingId) {
        if(pendingId.isNotBlank() && room.lastMessageId==pendingId &&
            room.preview==pendingText) {
            if(draft.trim()==pendingText) draft=""
            pendingId=""
            pendingText=""
        }
    }
    var messages by remember(uid,room.id) { mutableStateOf<List<AtrioGroupMessage>>(emptyList()) }
    var limit by remember(uid,room.id) { mutableIntStateOf(40) }
    var showMembers by remember(uid,room.id) { mutableStateOf(false) }
    var inviting by remember(uid,room.id) { mutableStateOf(false) }
    var busy by remember(uid,room.id) { mutableStateOf(false) }
    var error by remember(uid,room.id) { mutableStateOf("") }
    var reporting by remember(uid,room.id) { mutableStateOf<AtrioGroupMessage?>(null) }
    var reportReason by remember(uid,room.id) { mutableStateOf("") }
    val isAdmin=uid in room.adminUids
    val isOwner=uid==room.owner
    val isClosed=room.status=="closed"
    var confirmClose by remember(uid,room.id) { mutableStateOf(false) }
    // Uma assinatura para cada participante, não uma por bolha de mensagem.
    // Evita dezenas de listeners duplicados e leituras Firebase desnecessárias.
    var memberNames by remember(uid,room.id) { mutableStateOf<Map<String,String>>(emptyMap()) }
    DisposableEffect(db,room.id,room.memberUids) {
        val watchers=room.memberUids.distinct().map { memberId ->
            db.collection("public_profiles").document(memberId)
                .addSnapshotListener { snapshot,failure ->
                    if(failure==null) {
                        val label=snapshot?.getString("displayName")
                            ?.takeIf { it.isNotBlank() } ?: "Participante"
                        memberNames=memberNames+(memberId to label)
                    }
                }
        }
        onDispose { watchers.forEach { it.remove() } }
    }

    DisposableEffect(db,room.id,limit) {
        val listener=roomRef.collection("messages")
            .orderBy("createdAt",Query.Direction.DESCENDING).limit(limit.toLong())
            .addSnapshotListener { result,failure ->
                if(failure==null) messages=result?.documents.orEmpty()
                    .mapNotNull { doc ->
                        val sender=doc.getString("uid") ?: return@mapNotNull null
                        val text=doc.getString("text") ?: return@mapNotNull null
                        AtrioGroupMessage(doc.id,sender,text,
                            doc.getTimestamp("createdAt")?.toDate()?.time ?: 0,
                            doc.metadata.hasPendingWrites())
                    }.reversed()
                else error="Não foi possível carregar as mensagens do grupo."
            }
        onDispose { listener.remove() }
    }

    fun updateGroup(change: Map<String,Any>,success: String) {
        if(busy) return
        busy=true
        roomRef.update(change+("updatedAt" to FieldValue.serverTimestamp()))
            .addOnCompleteListener { response ->
                busy=false
                error=if(response.isSuccessful) success
                    else "Operação não permitida. As funções são validadas no servidor."
                if(response.isSuccessful && success=="Você saiu do grupo.") onBack()
            }
    }
    fun invite(peer: String) {
        if(busy || peer in room.memberUids || !isAdmin) return
        busy=true
        val inv=roomRef.collection("atrioGroupInvites").document(peer)
        inv.get().addOnCompleteListener { response ->
            if(!response.isSuccessful) {
                busy=false
                error="Não foi possível conferir o convite."
                return@addOnCompleteListener
            }
            val existing=response.result
            // Não atualizar convites feitos por outro administrador:
            // o ID da conversa associada precisa continuar verificável.
            if(existing?.exists()==true &&
                existing.getString("inviterUid")!=uid) {
                busy=false
                error="O convite anterior foi feito por outro administrador."
                return@addOnCompleteListener
            }
            val operation=if(existing?.exists()==true) {
                inv.update("status","pending",
                    "updatedAt",FieldValue.serverTimestamp())
            } else {
                inv.set(mapOf(
                    "inviteeUid" to peer,"inviterUid" to uid,
                    "contactChatId" to AtrioChatPolicy.id(uid,peer),
                    "groupName" to room.name,"status" to "pending",
                    "createdAt" to FieldValue.serverTimestamp(),
                    "updatedAt" to FieldValue.serverTimestamp()))
            }
            operation.addOnCompleteListener { saved ->
                busy=false
                error=if(saved.isSuccessful) "Convite enviado. A entrada exige aceite."
                    else "Convite recusado pelo servidor (contato bloqueado ou já participante)."
                if(saved.isSuccessful) inviting=false
            }
        }
    }
    fun send() {
        val text=draft.trim()
        if(busy || !AtrioChatPolicy.validText(text) ||
            FirebaseAuth.getInstance().currentUser?.uid!=uid) {
            error="Escreva somente texto com até 1.500 caracteres."
            return
        }
        busy=true
        // O mesmo ID acompanha a tentativa em caso de perda de resposta
        // da rede. O servidor recusa atualizações da mensagem já criada.
        val messageRef=if(pendingText==text && pendingId.isNotBlank())
            roomRef.collection("messages").document(pendingId)
        else roomRef.collection("messages").document().also {
            pendingId=it.id
            pendingText=text
        }
        db.runTransaction { tx ->
            // Firestore exige que todas as leituras venham antes das escritas.
            val current=tx.get(roomRef)
            val existing=tx.get(messageRef)
            check(current.getString("status")=="active" &&
                (current.get("memberUids") as? List<*>)?.contains(uid)==true)
            if(existing.exists()) {
                check(existing.getString("uid")==uid &&
                    existing.getString("text")==text)
                false // Envio anterior confirmado: nunca repetir ou notificar.
            } else {
                tx.set(messageRef,mapOf(
                    "uid" to uid,"text" to text,"kind" to "text",
                    "createdAt" to FieldValue.serverTimestamp()))
                tx.update(roomRef,mapOf(
                    "lastMessageId" to messageRef.id,
                    "lastPreview" to text,
                    "lastSenderUid" to uid,
                    "updatedAt" to FieldValue.serverTimestamp()))
                true
            }
        }.addOnCompleteListener { result ->
            busy=false
            if(result.isSuccessful) {
                if(draft.trim()==text) draft=""
                pendingId=""
                pendingText=""
                error=""
                if(result.result==true && pushEnabled &&
                    !(BuildConfig.DEBUG &&
                        com.google.firebase.FirebaseApp.getInstance().options.projectId==
                            "demo-atrio-v11"))
                    InstantPushRelay.groupMessage(room.id,messageRef.id)
            } else error="Envio não confirmado. Confira a conexão e respeite " +
                "o intervalo de mensagens do Guardião."
        }
    }
    Column(Modifier.fillMaxSize().testTag("atrio-group-thread")) {
        Row(Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment=Alignment.CenterVertically) {
            TextButton(onClick=onBack) { Text("Voltar") }
            Column(Modifier.weight(1f)) {
                Text(room.name,fontWeight=FontWeight.Bold,
                    maxLines=1,overflow=TextOverflow.Ellipsis,color=Wine)
                Text(AtrioGroupPolicy.categoryName(room.category),
                    color=Muted,fontSize=12.sp)
            }
            TextButton(onClick={
                db.collection("users").document(uid).collection("chatGroupBox")
                    .document(room.id).set(mapOf(
                        "muted" to !muted,
                        "updatedAt" to FieldValue.serverTimestamp()))
                    .addOnFailureListener { error="Não foi possível alterar os avisos." }
            },modifier=Modifier.testTag("atrio-group-mute")) {
                Text(if(muted) "Ativar avisos" else "Silenciar")
            }
            TextButton(onClick={showMembers=!showMembers},
                modifier=Modifier.testTag("atrio-group-members")) {
                Text("Pessoas")
            }
            if(isOwner && !isClosed) {
                TextButton(onClick={confirmClose=true},
                    modifier=Modifier.testTag("atrio-group-close-open")) {
                    Text("Encerrar")
                }
            }
        }
        if(isClosed) {
            Text("Grupo encerrado. O histórico continua disponível, " +
                "mas não é possível enviar mensagens nem convidar pessoas.",
                modifier=Modifier.padding(horizontal=14.dp,vertical=8.dp),
                fontSize=13.sp,color=Muted)
        }
        HorizontalDivider(color=Line)
        if(error.isNotBlank()) Text(error,Modifier.padding(12.dp),
            color=Muted,fontSize=13.sp)
        if(showMembers) {
            Column(Modifier.fillMaxWidth().padding(12.dp),
                verticalArrangement=Arrangement.spacedBy(4.dp)) {
                Text("Participantes • " + room.memberUids.size,
                    fontWeight=FontWeight.Bold,color=Wine)
                room.memberUids.forEach { member ->
                    val name=memberNames[member] ?: "Participante"
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Text(name + if(member in room.adminUids) " • administrador" else "",
                            fontSize=13.sp,modifier=Modifier.weight(1f))
                        if(!isClosed && isOwner && member!=room.owner) {
                            TextButton(onClick={
                                updateGroup(mapOf(
                                    "adminUids" to if(member in room.adminUids)
                                        FieldValue.arrayRemove(member)
                                        else FieldValue.arrayUnion(member),
                                    "lastRoleUid" to member),
                                    "Função atualizada.")
                            }) { Text(if(member in room.adminUids) "Rebaixar" else "Promover") }
                        }
                        if(!isClosed && isAdmin && member!=room.owner &&
                            member !in room.adminUids) {
                            TextButton(onClick={
                                updateGroup(mapOf(
                                    "memberUids" to FieldValue.arrayRemove(member),
                                    "lastRemovedUid" to member),
                                    "Participante removido.")
                            }) { Text("Remover") }
                        }
                    }
                }
                if(!isClosed && isAdmin &&
                    room.memberUids.size<AtrioGroupPolicy.MAX_MEMBERS) {
                    TextButton(onClick={inviting=!inviting},
                        modifier=Modifier.testTag("atrio-group-invite-open")) {
                        Text("Convidar participante")
                    }
                    if(inviting) {
                        Text("Escolha alguém com quem já possui conversa aceita.",
                            color=Muted,fontSize=12.sp)
                        val choices=knownPeers.filter {
                            it!=uid && it !in room.memberUids
                        }.distinct().take(12)
                        if(choices.isEmpty()) Text("Nenhum contato elegível listado.",color=Muted)
                        choices.forEach { candidate ->
                            val name=groupPeerName(db,candidate)
                            TextButton(onClick={invite(candidate)},enabled=!busy,
                                modifier=Modifier.testTag("atrio-group-invite-"+candidate)) {
                                Text("Convidar " + name)
                            }
                        }
                    }
                }
                if(!isOwner && !isAdmin) {
                    OutlinedButton(onClick={
                        updateGroup(mapOf(
                            "memberUids" to FieldValue.arrayRemove(uid),
                            "lastRemovedUid" to uid),
                            "Você saiu do grupo.")
                    },enabled=!busy,
                        modifier=Modifier.testTag("atrio-group-leave")) {
                        Text("Sair do grupo")
                    }
                } else if(isClosed && !isOwner && isAdmin) {
                    OutlinedButton(onClick={
                        updateGroup(mapOf(
                            "memberUids" to FieldValue.arrayRemove(uid),
                            "adminUids" to FieldValue.arrayRemove(uid),
                            "lastRemovedUid" to uid),
                            "Você saiu do grupo.")
                    },enabled=!busy,
                        modifier=Modifier.testTag("atrio-group-leave")) {
                        Text("Sair do grupo encerrado")
                    }
                } else if(!isClosed && !isOwner && isAdmin) {
                    Text("Para sair, solicite ao criador que retire primeiro " +
                        "sua função de administrador.",
                        fontSize=13.sp,color=Muted)
                }
            }
            HorizontalDivider(color=Line)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),
            contentPadding=PaddingValues(12.dp),
            verticalArrangement=Arrangement.spacedBy(9.dp)) {
            if(messages.isEmpty()) item {
                Text("Este grupo não substitui atendimento de emergência " +
                    "nem confissão sacramental.",
                    color=Muted,fontSize=12.sp)
            }
            if(messages.size>=limit) item {
                TextButton(onClick={limit+=40}) {
                    Text("Carregar mensagens anteriores")
                }
            }
            items(messages,key={it.id}) { item ->
                val mine=item.sender==uid
                val name=memberNames[item.sender] ?: "Membro anterior"
                Surface(shape=RoundedCornerShape(14.dp),
                    color=if(mine) WineSoft else MaterialTheme.colorScheme.surface,
                    border=BorderStroke(1.dp,Line),
                    modifier=Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(13.dp),
                        verticalArrangement=Arrangement.spacedBy(4.dp)) {
                        Text(name,fontSize=12.sp,fontWeight=FontWeight.SemiBold,
                            color=Wine)
                        Text(item.text,fontSize=16.sp,lineHeight=22.sp,color=Ink)
                        Text(if(item.pending) "Enviando..."
                            else if(item.sentAt<=0L) "" else
                            DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT)
                                .format(java.util.Date(item.sentAt)),
                            fontSize=12.sp,color=Muted)
                    }
                }
                TextButton(onClick={reporting=item;reportReason=""},
                    modifier=Modifier.testTag("atrio-group-report-message")) {
                    Text("Denunciar mensagem",fontSize=12.sp)
                }
            }
        }
        OutlinedTextField(draft,{if(it.length<=AtrioChatPolicy.MAX_TEXT) draft=it},
            modifier=Modifier.fillMaxWidth().padding(horizontal=12.dp)
                .testTag("atrio-group-composer"),
            enabled=!busy && !isClosed,label={Text("Mensagem ao grupo")},
            supportingText={Text(draft.length.toString()+"/1500 • somente texto")},
            maxLines=5)
        Button(onClick={send()},enabled=!busy && !isClosed && draft.isNotBlank(),
            modifier=Modifier.fillMaxWidth().padding(12.dp)
                .heightIn(min=48.dp).testTag("atrio-group-send")) {
            Text("Enviar ao grupo")
        }
    }
    if(confirmClose) {
        AlertDialog(
            onDismissRequest={if(!busy) confirmClose=false},
            title={Text("Encerrar este grupo?")},
            text={Text("Não será possível reabrir o grupo nem enviar " +
                "novas mensagens ou convites. O histórico existente será " +
                "mantido até a definição de uma política de retenção.")},
            confirmButton={
                TextButton(enabled=!busy,onClick={
                    busy=true
                    roomRef.update(mapOf(
                        "status" to "closed",
                        "closedByUid" to uid,
                        "closedAt" to FieldValue.serverTimestamp(),
                        "updatedAt" to FieldValue.serverTimestamp()))
                        .addOnCompleteListener { result ->
                            busy=false
                            confirmClose=false
                            error=if(result.isSuccessful)
                                "Grupo encerrado. Histórico preservado."
                            else "Não foi possível encerrar este grupo."
                        }
                },modifier=Modifier.testTag("atrio-group-close-confirm")) {
                    Text("Encerrar definitivamente")
                }
            },
            dismissButton={
                TextButton(onClick={if(!busy) confirmClose=false}) {
                    Text("Cancelar")
                }
            }
        )
    }
    if(reporting!=null) {
        val selected=reporting!!
        AlertDialog(
            onDismissRequest={if(!busy) reporting=null},
            title={Text("Denunciar mensagem do grupo")},
            text={
                Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text("A moderação recebe somente a mensagem selecionada e o motivo, " +
                        "não o histórico completo do grupo.",
                        color=Muted,fontSize=13.sp)
                    Text(selected.text,maxLines=3,overflow=TextOverflow.Ellipsis)
                    OutlinedTextField(reportReason,{reportReason=it.take(300)},
                        label={Text("Motivo da denúncia")},maxLines=4,
                        modifier=Modifier.fillMaxWidth())
                }
            },
            confirmButton={
                TextButton(enabled=!busy && reportReason.trim().length>=5,onClick={
                    busy=true
                    db.collection("chat_group_reports")
                        .document(uid+"__"+room.id+"__"+selected.id)
                        .set(mapOf(
                            "groupId" to room.id,
                            "messageId" to selected.id,
                            "reporterUid" to uid,
                            "reportedText" to selected.text,
                            "reason" to reportReason.trim(),
                            "createdAt" to FieldValue.serverTimestamp()))
                        .addOnCompleteListener { result ->
                            busy=false
                            if(result.isSuccessful) {
                                reporting=null
                                error="Denúncia registrada para análise."
                            } else error="Denúncia não confirmada ou já registrada."
                        }
                }) {Text("Enviar denúncia")}
            },
            dismissButton={
                TextButton(onClick={if(!busy) reporting=null}) {Text("Cancelar")}
            }
        )
    }
}
