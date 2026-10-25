package br.com.atriocatolico

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

internal val Wine = Color(0xFF632D39)
internal val WineSoft = Color(0xFFF3E8E8)
internal val Gold = Color(0xFFD4B16E)
internal val Paper = Color(0xFFF8F5F0)
internal val Ink = Color(0xFF292526)
internal val Muted = Color(0xFF827B77)
internal val Line = Color(0xFFEEE8E3)

internal data class Reply(
    val author: String,
    val message: String,
    val id: String = "",
    val mine: Boolean = false
)
internal data class Post(
    val id: String,
    val author: String,
    val category: String,
    val age: String,
    val title: String,
    val body: String,
    val likes: Int = 0,
    val liked: Boolean = false,
    val saved: Boolean = false,
    val mine: Boolean = false,
    val replies: List<Reply> = emptyList(),
    val remote: Boolean = false
)
internal enum class Tab(val label: String) {
    HOME("Início"), COMMUNITIES("Fóruns"), PUBLISH("Publicar"), SAVED("Salvos"), PROFILE("Perfil")
}
internal val categories = listOf(
    "Sagradas Escrituras" to "📖", "Apologética" to "🛡️",
    "Vida espiritual" to "🕊️", "História da Igreja" to "🏛️",
    "Liturgia" to "⛪", "Santos" to "✨",
    "Juventude" to "🌱", "Pedidos de oração" to "🙏"
)
private fun examplePosts() = listOf(
    Post("1", "Clara M.", "Apologética", "há 2 horas",
        "Qual é a diferença entre veneração e adoração?",
        "Gostaria de compreender melhor o ensinamento da Igreja sobre a intercessão dos santos. Como explicar isso com respeito a alguém que tem dúvidas?",86,
        replies = listOf(Reply("Rafael", "A adoração é devida somente a Deus. A veneração é uma forma de honra aos santos, que nos apontam para Cristo."), Reply("Beatriz", "Vale consultar o Catecismo, especialmente os parágrafos sobre comunhão dos santos."))),
    Post("2", "Rafael S.", "Vida espiritual", "há 5 horas", "Como começar a praticar a Lectio Divina?",
        "Estou tentando criar uma rotina de oração com a Palavra. Quais passos vocês recomendam para quem está começando?", 54,
        replies = listOf(Reply("Marina", "Leitura, meditação, oração e contemplação. Comece com um Evangelho curto e sem pressa."))),
    Post("3", "Helena P.", "Sagradas Escrituras", "ontem", "Por qual Evangelho vocês recomendam começar?",
        "Quero ajudar um grupo de jovens a conhecer melhor a vida de Jesus. Qual Evangelho seria uma boa porta de entrada?",42,
        replies = listOf(Reply("João", "O Evangelho de Marcos é conciso e costuma funcionar muito bem para uma primeira leitura."))),
    Post("4", "Bruno L.", "História da Igreja", "ontem", "Qual Padre da Igreja mais marcou seus estudos?",
        "Tenho lido Santo Agostinho e gostaria de conhecer outras obras dos primeiros séculos do cristianismo.",31),
    Post("5", "Ana R.", "Pedidos de oração", "há 2 dias", "Uma oração pelas famílias que enfrentam dificuldades",
        "Deixem aqui suas intenções. Vamos unir nossas orações durante esta semana.",119,
        replies = listOf(Reply("Luís", "Uno minhas orações às de vocês. 🙏")))
)

private fun readPosts(prefs: SharedPreferences): List<Post> = try {
    val stored = prefs.getString("posts", null)
    if (stored == null) examplePosts() else {
        val arr = JSONArray(stored)
        List(arr.length()) { i ->
            val p = arr.getJSONObject(i)
            val rs = p.optJSONArray("replies") ?: JSONArray()
            Post(
                id = p.getString("id"), author = p.getString("author"),
                category = p.getString("category"), age = p.getString("age"),
                title = p.getString("title"), body = p.getString("body"),
                likes = p.optInt("likes"), liked = p.optBoolean("liked"),
                saved = p.optBoolean("saved"), mine = p.optBoolean("mine"),
                replies = List(rs.length()) { j ->
                    val r = rs.getJSONObject(j)
                    Reply(r.getString("author"), r.getString("message"))
                }
            )
        }
    }
} catch (_: Exception) { examplePosts() }

private fun persistPosts(prefs: SharedPreferences, posts: List<Post>) {
    val all = JSONArray()
    posts.forEach { p ->
        val rs = JSONArray()
        p.replies.forEach { r -> rs.put(JSONObject().put("author", r.author).put("message", r.message)) }
        all.put(JSONObject().put("id", p.id).put("author", p.author)
            .put("category", p.category).put("age", p.age).put("title", p.title)
            .put("body", p.body).put("likes", p.likes).put("liked", p.liked)
            .put("saved", p.saved).put("mine", p.mine).put("replies", rs))
    }
    prefs.edit().putString("posts", all.toString()).apply()
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("atrio-demo", Context.MODE_PRIVATE)
        setContent {
            if (com.google.firebase.FirebaseApp.getApps(this).isNotEmpty()) {
                OnlineAtrioApp()
            } else {
                AtrioDemoApp(prefs)
            }
        }
    }
}

@Composable
internal fun AtrioTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Wine, onPrimary = Color.White, secondary = Gold,
            background = Paper, onBackground = Ink, surface = Color.White,
            onSurface = Ink, surfaceVariant = WineSoft
        ), content = content
    )
}

@Composable
internal fun AtrioDemoApp(prefs: SharedPreferences) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var name by remember { mutableStateOf(prefs.getString("name", "").orEmpty()) }
    val posts = remember { mutableStateListOf<Post>().apply { addAll(readPosts(prefs)) } }
    var tab by remember { mutableStateOf(Tab.HOME) }
    var filter by remember { mutableStateOf("Todos") }
    var detailId by remember { mutableStateOf<String?>(null) }
    var searchOpen by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var renameOpen by remember { mutableStateOf(false) }

    fun replacePost(id: String, f: (Post) -> Post) {
        val index = posts.indexOfFirst { it.id == id }
        if (index >= 0) {
            posts[index] = f(posts[index])
            persistPosts(prefs, posts)
        }
    }
    fun visit(t: Tab) { tab = t; detailId = null; filter = "Todos"; search = ""; searchOpen = false }

    AtrioTheme {
        if (name.isBlank()) {
            WelcomeScreen { newName ->
                name = newName.trim()
                prefs.edit().putString("name", name).apply()
            }
        } else {
            Scaffold(
                containerColor = Paper,
                topBar = {
                    AtrioTopBar(
                        details = detailId != null,
                        onBack = { detailId = null },
                        onSearch = { val shouldOpen = !searchOpen; visit(Tab.HOME); searchOpen = shouldOpen },
                        onNotification = { Toast.makeText(context, "Nenhuma notificação nova", Toast.LENGTH_SHORT).show() }
                    )
                },
                bottomBar = { AtrioBottomBar(selected = tab, onSelect = ::visit) }
            ) { padding ->
                Box(Modifier.padding(padding)) {
                    val details = posts.find { it.id == detailId }
                    if (details != null) {
                        DetailScreen(
                            post = details, name = name,
                            onLike = { replacePost(details.id) { it.copy(liked = !it.liked, likes = it.likes + if (it.liked) -1 else 1) } },
                            onSave = { replacePost(details.id) { it.copy(saved = !it.saved) } },
                            onReply = { reply ->
                                replacePost(details.id) { it.copy(replies = it.replies + Reply(name, reply)) }
                                Toast.makeText(context, "Resposta publicada!", Toast.LENGTH_SHORT).show()
                            }
                        )
                    } else when (tab) {
                        Tab.HOME -> HomeScreen(
                            name = name, posts = posts, filter = filter,
                            search = search, searchOpen = searchOpen,
                            onSearch = { search = it }, onFilter = { filter = it },
                            onCreate = { visit(Tab.PUBLISH) },
                            onForums = { visit(Tab.COMMUNITIES) },
                            onOpen = { detailId = it },
                            onLike = { id -> replacePost(id) { it.copy(liked = !it.liked, likes = it.likes + if (it.liked) -1 else 1) } },
                            onSave = { id -> replacePost(id) { it.copy(saved = !it.saved) } }
                        )
                        Tab.COMMUNITIES -> CommunityScreen(posts) { cat -> visit(Tab.HOME); filter = cat }
                        Tab.PUBLISH -> PublishScreen { title, body, category ->
                            posts.add(0, Post(System.currentTimeMillis().toString(), name, category, "agora", title, body, mine = true))
                            persistPosts(prefs, posts)
                            visit(Tab.HOME)
                            Toast.makeText(context, "Sua discussão foi publicada!", Toast.LENGTH_SHORT).show()
                        }
                        Tab.SAVED -> SavedScreen(
                            posts.filter { it.saved }, onDiscover = { visit(Tab.HOME) },
                            onOpen = { detailId = it },
                            onLike = { id -> replacePost(id) { it.copy(liked = !it.liked, likes = it.likes + if (it.liked) -1 else 1) } },
                            onSave = { id -> replacePost(id) { it.copy(saved = !it.saved) } }
                        )
                        Tab.PROFILE -> ProfileScreen(
                            name = name, posts = posts, onRename = { renameOpen = true },
                            onCreate = { visit(Tab.PUBLISH) }, onOpen = { detailId = it },
                            onLike = { id -> replacePost(id) { it.copy(liked = !it.liked, likes = it.likes + if (it.liked) -1 else 1) } },
                            onSave = { id -> replacePost(id) { it.copy(saved = !it.saved) } },
                            onReset = {
                                prefs.edit().clear().apply()
                                posts.clear(); posts.addAll(examplePosts()); name = ""; visit(Tab.HOME)
                            }
                        )
                    }
                }
            }
            if (renameOpen) {
                var edit by remember { mutableStateOf(name) }
                AlertDialog(
                    onDismissRequest = { renameOpen = false }, title = { Text("Editar nome") },
                    text = { OutlinedTextField(value = edit, onValueChange = { if (it.length <= 35) edit = it }, label = { Text("Nome") }) },
                    confirmButton = { TextButton(enabled = edit.trim().length >= 2, onClick = {
                        val old = name
                        name = edit.trim()
                        prefs.edit().putString("name", name).apply()
                        posts.indices.filter { posts[it].mine && posts[it].author == old }
                            .forEach { i -> posts[i] = posts[i].copy(author = name) }
                        persistPosts(prefs, posts)
                        renameOpen = false
                    }) { Text("Salvar") } },
                    dismissButton = { TextButton(onClick = { renameOpen = false }) { Text("Cancelar") } }
                )
            }
        }
    }
}

@Composable
private fun WelcomeScreen(onEnter: (String) -> Unit) {
    var nickname by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Wine, Color(0xFF864453))))
            .statusBarsPadding().padding(horizontal = 26.dp, vertical = 40.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column {
            Box(Modifier.size(65.dp).clip(RoundedCornerShape(20.dp)).background(Color.White.copy(alpha = .14f)), contentAlignment = Alignment.Center) {
                Text("✝", fontSize = 40.sp, color = Gold, fontFamily = FontFamily.Serif)
            }
            Spacer(Modifier.height(36.dp))
            Text("BEM-VINDO AO ÁTRIO CATÓLICO", color = Gold, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            Spacer(Modifier.height(14.dp))
            Text("Uma comunidade.\nUma só fé.", color = Color.White, fontSize = 39.sp, lineHeight = 45.sp, fontFamily = FontFamily.Serif)
            Spacer(Modifier.height(20.dp))
            Text("Converse sobre a fé católica, encontre novos amigos e aprofunde seus conhecimentos.", color = Color(0xFFF5DDE5), fontSize = 15.sp, lineHeight = 24.sp)
            Spacer(Modifier.height(28.dp))
            Text("“Onde dois ou três estiverem reunidos em meu nome, aí estou eu no meio deles.”\n— Mateus 18,20",
                color = Color(0xFFEFCFDC), fontFamily = FontFamily.Serif, lineHeight = 24.sp)
        }
        Card(colors = CardDefaults.cardColors(containerColor = Paper), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.padding(20.dp)) {
                Text("Vamos começar?", fontFamily = FontFamily.Serif, fontSize = 23.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(7.dp))
                Text("Escolha um nome para a demonstração. Não é necessário criar conta.", fontSize = 12.sp, color = Muted, lineHeight = 19.sp)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(nickname, { if (it.length <= 35) nickname = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Seu nome") }, singleLine = true)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { onEnter(nickname) }, enabled = nickname.trim().length >= 2,
                    modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) { Text("Entrar na comunidade  →") }
                Spacer(Modifier.height(5.dp))
                Text("Demonstração local · Sem cadastro real", fontSize = 10.sp, color = Muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
internal fun AtrioTopBar(details: Boolean, onBack: () -> Unit, onSearch: () -> Unit, onNotification: () -> Unit) {
    // O Android desenha o app sob a barra de status; reserva a área do relógio.
    Surface(color = Paper, modifier = Modifier.statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(68.dp).padding(horizontal = 17.dp), verticalAlignment = Alignment.CenterVertically) {
            if (details) {
                IconButton(onClick = onBack) { Icon(Icons.Outlined.ArrowBack, contentDescription = "Voltar", tint = Wine) }
                Text("Discussão", fontSize = 23.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Serif, color = Wine)
            } else {
                Box(Modifier.size(39.dp).clip(RoundedCornerShape(12.dp)).background(Wine), contentAlignment = Alignment.Center) {
                    Text("✝", fontSize = 25.sp, fontFamily = FontFamily.Serif, color = Gold)
                }
                Spacer(Modifier.width(10.dp))
                Text("Átrio", fontSize = 26.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, color = Wine)
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onSearch) { Icon(Icons.Outlined.Search, "Buscar", tint = Wine) }
            IconButton(onClick = onNotification) { Icon(Icons.Outlined.NotificationsNone, "Notificações", tint = Wine) }
        }
    }
}

@Composable
internal fun AtrioBottomBar(selected: Tab, onSelect: (Tab) -> Unit) {
    NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
        Tab.entries.forEach { tab ->
            val icon = when (tab) {
                Tab.HOME -> Icons.Outlined.Home
                Tab.COMMUNITIES -> Icons.Outlined.Groups
                Tab.PUBLISH -> Icons.Outlined.Add
                Tab.SAVED -> Icons.Outlined.BookmarkBorder
                Tab.PROFILE -> Icons.Outlined.AccountCircle
            }
            NavigationBarItem(
                selected = selected == tab, onClick = { onSelect(tab) },
                icon = { Icon(icon, contentDescription = null) }, label = { Text(tab.label, fontSize = 11.sp) },
                colors = NavigationBarItemDefaults.colors(selectedIconColor = Wine, selectedTextColor = Wine, indicatorColor = WineSoft)
            )
        }
    }
}

@Composable
internal fun Avatar(name: String, modifier: Modifier = Modifier) {
    Box(modifier.size(40.dp).clip(CircleShape).background(Color(0xFFF1DFE6)), contentAlignment = Alignment.Center) {
        Text(name.firstOrNull()?.uppercase() ?: "A", fontSize = 18.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, color = Wine)
    }
}

@Composable
internal fun DiscussionCard(post: Post, onOpen: (String) -> Unit, onLike: (String) -> Unit, onSave: (String) -> Unit) {
    Card(
        onClick = { onOpen(post.id) }, modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(17.dp), colors = CardDefaults.cardColors(containerColor = Color.White),
        border = BorderStroke(1.dp, Line), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(post.author)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(post.author, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    Text("${post.category} · ${post.age}", fontSize = 11.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.height(14.dp))
            Text(post.title, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(7.dp))
            Text(post.body, color = Color(0xFF68625E), fontSize = 13.sp, lineHeight = 20.sp, maxLines = 5, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(10.dp))
            Surface(color = WineSoft, shape = RoundedCornerShape(7.dp)) { Text(post.category, color = Wine, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) }
            Spacer(Modifier.height(13.dp))
            HorizontalDivider(color = Line)
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onLike(post.id) }) {
                    Icon(if (post.liked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder, "Curtir", tint = if (post.liked) Wine else Muted, modifier = Modifier.size(20.dp))
                }
                Text(if (post.remote) "Curtir" else post.likes.toString(), color = if (post.liked) Wine else Muted, fontSize = 12.sp)
                IconButton(onClick = { onOpen(post.id) }) { Icon(Icons.Outlined.ChatBubbleOutline, "Respostas", tint = Muted, modifier = Modifier.size(20.dp)) }
                Text(if (post.remote) "Ver respostas" else "${post.replies.size} respostas", color = Muted, fontSize = 12.sp)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { onSave(post.id) }) { Icon(if (post.saved) Icons.Outlined.Bookmark else Icons.Outlined.BookmarkBorder, "Salvar", tint = if (post.saved) Wine else Muted, modifier = Modifier.size(21.dp)) }
            }
        }
    }
}

@Composable
internal fun HomeScreen(name: String, posts: List<Post>, filter: String, search: String, searchOpen: Boolean,
    onSearch: (String) -> Unit, onFilter: (String) -> Unit, onCreate: () -> Unit,
    onForums: () -> Unit, onOpen: (String) -> Unit, onLike: (String) -> Unit, onSave: (String) -> Unit
) {
    val shown = posts.filter { (filter == "Todos" || it.category == filter) &&
        (search.isBlank() || listOf(it.title, it.body, it.category, it.author).any { s -> s.contains(search, ignoreCase = true) }) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Brush.horizontalGradient(listOf(Wine, Color(0xFF824657)))).padding(24.dp)) {
                Column {
                    Text("COMUNIDADE CATÓLICA", color = Gold, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.5.sp)
                    Spacer(Modifier.height(9.dp))
                    Text("Paz e bem, ${name.substringBefore(' ')}!", color = Color.White, fontFamily = FontFamily.Serif, fontSize = 27.sp)
                    Spacer(Modifier.height(7.dp))
                    Text("Um lugar para ouvir, aprender e crescer juntos na fé.", color = Color(0xFFF4DCE4), fontSize = 13.sp, lineHeight = 19.sp)
                }
            }
        }
        item {
            Surface(onClick = onCreate, color = Color.White, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Line)) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(name); Spacer(Modifier.width(12.dp))
                    Text("O que você gostaria de compartilhar?", color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Icon(Icons.Outlined.Add, null, tint = Wine)
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                SectionTitle("Em conversa", Modifier.weight(1f))
                TextButton(onClick = onForums) { Text("Ver fóruns →", color = Wine, fontSize = 12.sp) }
            }
        }
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selected = filter == "Todos", onClick = { onFilter("Todos") }, label = { Text("Todos") }) }
                items(categories) { (cat, _) -> FilterChip(selected = filter == cat, onClick = { onFilter(cat) }, label = { Text(cat) }) }
            }
        }
        if (searchOpen) item {
            OutlinedTextField(value = search, onValueChange = onSearch, label = { Text("Buscar discussões") },
                leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        }
        if (shown.isEmpty()) item { EmptyState("🕊️", "Nenhuma discussão", "Mude o filtro ou comece uma conversa.", "Criar publicação", onCreate) }
        items(shown, key = { it.id }) { p -> DiscussionCard(p, onOpen, onLike, onSave) }
    }
}

@Composable
internal fun SectionTitle(label: String, modifier: Modifier = Modifier) {
    Text(label, fontFamily = FontFamily.Serif, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = modifier)
}

@Composable
internal fun CommunityScreen(posts: List<Post>, onChoose: (String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(14.dp)); SectionTitle("Fóruns da comunidade")
        Spacer(Modifier.height(7.dp))
        Text("Explore os temas e participe de discussões respeitosas.", fontSize = 13.sp, color = Muted)
        Spacer(Modifier.height(18.dp))
        LazyVerticalGrid(columns = GridCells.Fixed(2), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 25.dp)) {
            gridItems(categories) { (cat, symbol) ->
                Card(onClick = { onChoose(cat) }, shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Line)) {
                    Column(Modifier.fillMaxWidth().height(125.dp).padding(13.dp), verticalArrangement = Arrangement.SpaceBetween) {
                        Text(symbol, fontSize = 26.sp)
                        Column {
                            Text(cat, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 16.sp)
                            Text("${posts.count { it.category == cat }} discussões", fontSize = 11.sp, color = Muted)
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun PublishScreen(onPublish: (String, String, String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(categories[0].first) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(17.dp)) {
        SectionTitle("Nova discussão")
        Spacer(Modifier.height(7.dp))
        Text("Uma boa pergunta pode abrir uma grande conversa.", fontSize = 13.sp, color = Muted)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(value = title, onValueChange = { if (it.length <= 120) title = it },
            modifier = Modifier.fillMaxWidth(), label = { Text("Título da publicação") }, placeholder = { Text("Sobre o que deseja conversar?") })
        Spacer(Modifier.height(16.dp))
        Text("Escolha um assunto", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        categories.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (cat, _) ->
                    FilterChip(selected = category == cat, onClick = { category = cat }, label = { Text(cat, fontSize = 11.sp) })
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(value = body, onValueChange = { if (it.length <= 1200) body = it },
            modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp),
            label = { Text("Sua reflexão ou pergunta") },
            placeholder = { Text("Compartilhe sua dúvida ou experiência com respeito...") }, minLines = 5)
        Text("${body.length}/1200", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End, color = Muted, fontSize = 11.sp)
        Spacer(Modifier.height(13.dp))
        Text("🕊️ Seja cordial, evite dados pessoais sensíveis e respeite as regras da comunidade.", color = Muted, fontSize = 12.sp, lineHeight = 19.sp)
        Spacer(Modifier.height(18.dp))
        Button(onClick = { onPublish(title.trim(), body.trim(), category); title = ""; body = "" },
            enabled = title.trim().length >= 5 && body.trim().length >= 5,
            modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(12.dp)) { Text("Publicar discussão") }
    }
}

@Composable
internal fun SavedScreen(posts: List<Post>, onDiscover: () -> Unit, onOpen: (String) -> Unit, onLike: (String) -> Unit, onSave: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { SectionTitle("Publicações salvas") }
        if (posts.isEmpty()) item { EmptyState("🔖", "Nada salvo ainda", "Toque no marcador de uma publicação para encontrá-la aqui.", "Explorar discussões", onDiscover) }
        items(posts, key = { it.id }) { p -> DiscussionCard(p, onOpen, onLike, onSave) }
    }
}

@Composable
private fun ProfileScreen(name: String, posts: List<Post>, onRename: () -> Unit, onCreate: () -> Unit,
    onOpen: (String) -> Unit, onLike: (String) -> Unit, onSave: (String) -> Unit, onReset: () -> Unit) {
    val mine = posts.filter { it.mine }
    var confirmReset by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 9.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(name, Modifier.size(78.dp))
                Spacer(Modifier.height(9.dp))
                Text(name, fontFamily = FontFamily.Serif, fontSize = 23.sp, fontWeight = FontWeight.Bold)
                Text("Membro da comunidade Átrio", fontSize = 12.sp, color = Muted)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = onRename) { Text("Editar nome") }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Line)) {
                Row(Modifier.fillMaxWidth().padding(vertical = 17.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                    Statistic("${mine.size}", "Publicações")
                    Statistic("${posts.count { it.saved }}", "Salvos")
                    Statistic("${mine.sumOf { it.likes }}", "Curtidas")
                }
            }
        }
        item { SectionTitle("Minhas publicações") }
        if (mine.isEmpty()) item { EmptyState("✍️", "Sua voz faz diferença", "Compartilhe uma dúvida ou reflexão com a comunidade.", "Escrever agora", onCreate) }
        items(mine, key = { it.id }) { p -> DiscussionCard(p, onOpen, onLike, onSave) }
        item {
            Text("🔐 Esta versão é uma demonstração. Os dados ficam somente neste dispositivo; não existem contas reais nem servidor.", fontSize = 12.sp, color = Muted, lineHeight = 19.sp)
            TextButton(onClick = { confirmReset = true }) { Text("Reiniciar demonstração") }
        }
    }
    if (confirmReset) AlertDialog(onDismissRequest = { confirmReset = false }, title = { Text("Reiniciar demonstração?") },
        text = { Text("Suas publicações e preferências locais serão apagadas.") },
        confirmButton = { TextButton(onClick = { confirmReset = false; onReset() }) { Text("Reiniciar") } },
        dismissButton = { TextButton(onClick = { confirmReset = false }) { Text("Cancelar") } })
}

@Composable
private fun Statistic(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 19.sp, color = Wine, fontWeight = FontWeight.Bold)
        Text(label, fontSize = 11.sp, color = Muted)
    }
}

@Composable
internal fun DetailScreen(
    post: Post, name: String, onLike: () -> Unit, onSave: () -> Unit,
    onReply: (String) -> Unit, onReport: (() -> Unit)? = null,
    onEdit: (() -> Unit)? = null, onDelete: (() -> Unit)? = null,
    onDeleteReply: ((String) -> Unit)? = null
) {
    var response by remember(post.id) { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        DiscussionCard(post, onOpen = {}, onLike = { onLike() }, onSave = { onSave() })
        if (post.mine && (onEdit != null || onDelete != null)) {
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (onEdit != null) {
                    OutlinedButton(onClick = onEdit) { Text("Editar discussão") }
                }
                if (onDelete != null) {
                    TextButton(onClick = onDelete) { Text("Excluir discussão", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        SectionTitle("Respostas (${post.replies.size})")
        Spacer(Modifier.height(11.dp))
        if (post.replies.isEmpty()) Text("Seja a primeira pessoa a responder!", fontSize = 13.sp, color = Muted)
        post.replies.forEach { r ->
            Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                Avatar(r.author, Modifier.size(36.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(r.author, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    Text(r.message, fontSize = 13.sp, lineHeight = 19.sp, color = Ink)
                }
                if (r.mine && r.id.isNotBlank() && onDeleteReply != null) {
                    TextButton(onClick = { onDeleteReply(r.id) }) {
                        Text("Excluir", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    }
                }
            }
            HorizontalDivider(color = Line)
        }
        Spacer(Modifier.height(14.dp))
        Text("Responder como $name", color = Wine, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(value = response, onValueChange = { if (it.length <= 600) response = it },
            modifier = Modifier.fillMaxWidth(), label = { Text("Sua resposta") }, minLines = 2)
        Spacer(Modifier.height(9.dp))
        Button(onClick = { onReply(response.trim()); response = "" }, enabled = response.isNotBlank(), modifier = Modifier.align(Alignment.End)) { Text("Enviar resposta") }
        if (onReport != null) {
            TextButton(onClick = onReport, modifier = Modifier.align(Alignment.End)) { Text("Denunciar discussão") }
        }
        Spacer(Modifier.height(25.dp))
    }
}

@Composable
internal fun EmptyState(emoji: String, title: String, description: String, button: String, action: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 46.dp, horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(emoji, fontSize = 43.sp)
        Spacer(Modifier.height(8.dp))
        Text(title, fontSize = 21.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold, color = Wine)
        Spacer(Modifier.height(7.dp))
        Text(description, fontSize = 13.sp, color = Muted, textAlign = TextAlign.Center, lineHeight = 19.sp)
        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = action) { Text(button) }
    }
}
