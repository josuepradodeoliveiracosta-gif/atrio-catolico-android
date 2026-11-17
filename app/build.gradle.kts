plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Prévia visual v2: somente demonstração local, sem Firebase ou push oficiais.
val atrioDesignPreview = System.getenv("ATRIO_DESIGN_PREVIEW") == "1"
// A QA OTA usa um pacote isolado .otalab e não toca Firebase de produção.
// Por isso NÃO aplica Google Services nesse build exclusivamente Debug.
val atrioOtaQaLoopback = System.getenv("ATRIO_OTA_QA_LOOPBACK") == "1"
// O piloto NÃO é uma publicacao: somente um buildType distinto, nao depuravel,
// com pacote e certificado oficiais. O modo normal fica completamente intocado.
val atrioOtaReleasePilot = System.getenv("ATRIO_OTA_RELEASE_PILOT") == "1"
val atrioOtaPilotCompileOnly = System.getenv("ATRIO_OTA_PILOT_COMPILE_ONLY") == "1"
val atrioOtaPilotEnabled = atrioOtaReleasePilot || atrioOtaPilotCompileOnly
// QA Geral usa emuladores por padrão. A homologação física é um build opt-in.
val atrioQaGeralBuild = System.getenv("ATRIO_QA_GERAL_BUILD") == "1"
val atrioQaGeralRemote = System.getenv("ATRIO_QA_GERAL_REMOTE_BUILD") == "1"
val atrioQaGeralPush = System.getenv("ATRIO_QA_GERAL_PUSH_BUILD") == "1"
val atrioQaGeralCelularFicticio = System.getenv("ATRIO_QA_GERAL_CELULAR_FICTICIO") == "1"
val atrioQaGeralCelularUnsigned = System.getenv("ATRIO_QA_GERAL_CELULAR_UNSIGNED_BUILD") == "1"
val atrioQaGeralCelularPairCode = System.getenv("ATRIO_QA_GERAL_CELULAR_PAIR_CODE").orEmpty()
require(atrioQaGeralCelularPairCode.isEmpty() ||
    (atrioQaGeralCelularUnsigned && atrioQaGeralCelularPairCode in setOf("38", "39"))) {
    "O par de atualização QA Celular exige o build fictício sem assinatura e versionCode 38 ou 39."
}
require(!atrioQaGeralCelularUnsigned || atrioQaGeralCelularFicticio) {
    "O build sem assinatura é exclusivo do QA Geral Celular fictício."
}
require(!atrioQaGeralCelularFicticio || (atrioQaGeralRemote && !atrioQaGeralPush)) {
    "O pacote QA Geral Celular fictício requer o build dedicado e mantém o push desabilitado."
}
require(!atrioQaGeralPush || atrioQaGeralRemote) {
    "O Push do QA Geral requer o build dedicado para celular."
}
val atrioQaGeralRemoteProject = if (atrioQaGeralCelularFicticio)
    "atrio-catolico-qa-geral-ficticio" else "atrio-catolico-qa-general"
val atrioQaGeralRemoteAppId = if (atrioQaGeralCelularFicticio)
    "1:000000000000:android:0000000000000000000000" else "1:835727158563:android:618218ab4be326d75cb096"
val atrioQaGeralPackageSuffix = if (atrioQaGeralCelularFicticio) ".qageral.celular" else ".qageral"
require(!atrioQaGeralRemote || atrioQaGeralBuild) {
    "A homologação física requer o build QA Geral."
}
if (atrioQaGeralBuild) {
    require(!atrioDesignPreview && !atrioOtaQaLoopback && !atrioOtaPilotEnabled &&
        System.getenv("ATRIO_CHAT_QA_BUILD") != "1" &&
        System.getenv("ATRIO_PERFIL_QA_BUILD") != "1") {
        "QA Geral nao combina variantes restritas, preview ou OTA."
    }
    require(gradle.startParameter.taskNames.isNotEmpty() &&
        gradle.startParameter.taskNames.all {
            it.substringAfterLast(':') in setOf(
                "assembleQaGeral", "assembleQaGeralAndroidTest",
                "connectedQaGeralAndroidTest", "testQaGeralUnitTest"
            )
        }) { "QA Geral: somente tarefas explicitas da variante local." }
    require(listOf(
        "ATRIO_PUSH_WORKER_URL", "ATRIO_AVATAR_WORKER_URL",
        "ATRIO_GUARDIAN_V2_WORKER_URL", "ATRIO_CHAT_QA_WORKER_URL",
        "ATRIO_SIGNING_STORE_FILE", "ATRIO_SIGNING_STORE_PASSWORD",
        "ATRIO_SIGNING_KEY_ALIAS", "ATRIO_SIGNING_KEY_PASSWORD",
        "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT_JSON"
    ).all { System.getenv(it).isNullOrBlank() }) {
        "QA Geral nao aceita endpoints, credenciais Admin ou assinatura real."
    }
    val qaConfig = file("src/qaGeral/google-services.json")
    require(listOf(
        "google-services.json", "src/chatQa/google-services.json", "src/perfilQa/google-services.json"
    ).none { file(it).exists() }) {
        "QA Geral exige checkout sem configuração Firebase oficial ou de outras variantes."
    }
    if (atrioQaGeralRemote) {
        val allowedTasks = if (atrioQaGeralCelularFicticio) {
            setOf("assembleQaGeral", "testQaGeralUnitTest")
        } else {
            setOf("assembleQaGeral")
        }
        require(gradle.startParameter.taskNames.all { it.substringAfterLast(':') in allowedTasks }) {
            "QA Geral para celular: somente compilação e, no modo fictício, testes unitários."
        }
        val preflight = ProcessBuilder(
            "python3", rootProject.file("scripts/qa_geral_remote_build_gate.py").absolutePath,
            qaConfig.absolutePath, atrioQaGeralRemoteProject, atrioQaGeralRemoteAppId,
            "br.com.atriocatolico$atrioQaGeralPackageSuffix"
        ).inheritIO().start()
        require(preflight.waitFor() == 0) { "Configuração Firebase do QA Geral para celular recusada." }
    } else {
        require(!qaConfig.exists()) { "QA Geral local não usa google-services.json." }
    }
}
// O chat QA possui pacote e Firebase próprios; nunca habilitar por padrão.
val atrioChatQaBuild = System.getenv("ATRIO_CHAT_QA_BUILD") == "1"
// O Worker QA nao oferece acesso publico. Sem relay, apenas build isolado.
val atrioChatQaOffline = System.getenv("ATRIO_CHAT_QA_OFFLINE_ONLY") == "1"
if (atrioChatQaBuild) {
    require(System.getenv("ATRIO_CHAT_QA_OFFLINE_ONLY").orEmpty() in setOf("", "1")) {
        "Chat QA: modo offline invalido."
    }
    if (atrioChatQaOffline) {
        require(System.getenv("ATRIO_CHAT_QA_WORKER_URL").isNullOrBlank()) {
            "Chat QA offline nunca incorpora URL de Worker."
        }
    }
    require(!atrioDesignPreview && !atrioOtaQaLoopback && !atrioOtaPilotEnabled &&
        System.getenv("ATRIO_PERFIL_QA_BUILD") != "1") {
        "Chat QA nao pode coexistir com Perfil QA, preview, OTA ou piloto."
    }
    require(gradle.startParameter.taskNames.isNotEmpty() &&
        gradle.startParameter.taskNames.all {
            it.substringAfterLast(':') == "assembleChatQa"
        }) { "Chat QA: exclusivamente assembleChatQa." }
    require(listOf(
        "ATRIO_PUSH_WORKER_URL", "ATRIO_AVATAR_WORKER_URL",
        "ATRIO_GUARDIAN_V2_WORKER_URL", "ATRIO_SIGNING_STORE_FILE",
        "ATRIO_SIGNING_STORE_PASSWORD", "ATRIO_SIGNING_KEY_ALIAS",
        "ATRIO_SIGNING_KEY_PASSWORD",
        "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT_JSON"
    ).all { System.getenv(it).isNullOrBlank() }) {
        "Chat QA exige ambiente sem URLs gerais, credenciais de Admin ou assinatura."
    }
    require(file("src/chatQa/google-services.json").isFile) {
        "Chat QA exige um google-services.json de QA separado."
    }
    val preflight = ProcessBuilder(
        "python3", rootProject.file("scripts/chat_qa_build_gate.py").absolutePath
    ).directory(rootProject.projectDir).inheritIO().start()
    require(preflight.waitFor() == 0) {
        "Chat QA bloqueado pelo preflight offline."
    }
}
// O build Perfil QA e opt-in; nunca participa do APK oficial.
val atrioPerfilQaBuild = System.getenv("ATRIO_PERFIL_QA_BUILD") == "1"
if (atrioPerfilQaBuild) {
    require(!atrioDesignPreview && !atrioOtaQaLoopback && !atrioOtaPilotEnabled &&
        System.getenv("ATRIO_CHAT_QA_BUILD") != "1") {
        "Perfil QA nao pode coexistir com Chat QA, preview, OTA ou piloto."
    }
    require(gradle.startParameter.taskNames.isNotEmpty() &&
        gradle.startParameter.taskNames.all { it.substringAfterLast(':') == "assemblePerfilQa" }) {
        "Perfil QA: executar somente :app:assemblePerfilQa."
    }
    require(listOf(
        "ATRIO_PUSH_WORKER_URL", "ATRIO_AVATAR_WORKER_URL",
        "ATRIO_GUARDIAN_V2_WORKER_URL", "ATRIO_CHAT_QA_WORKER_URL",
        "ATRIO_SIGNING_STORE_FILE", "ATRIO_SIGNING_STORE_PASSWORD",
        "ATRIO_SIGNING_KEY_ALIAS", "ATRIO_SIGNING_KEY_PASSWORD",
        "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT_JSON"
    ).all { System.getenv(it).isNullOrBlank() }) {
        "Perfil QA exige ambiente sem endpoints, credenciais de Admin ou assinatura oficial."
    }
    require(file("src/perfilQa/google-services.json").isFile) {
        "Perfil QA exige sua configuracao exclusiva; nao usar google-services.json oficial."
    }
    val qaPreflight = ProcessBuilder(
        "python3", rootProject.file("scripts/perfil_qa_build_gate.py").absolutePath
    ).directory(rootProject.projectDir).inheritIO().start()
    require(qaPreflight.waitFor() == 0) {
        "Perfil QA bloqueado pelo verificador local de identidade Firebase."
    }
}
require(!(atrioOtaQaLoopback && atrioOtaPilotEnabled)) {
    "Laboratorio Debug e piloto Release nao podem ser ativos juntos."
}
require(!(atrioOtaReleasePilot && atrioOtaPilotCompileOnly)) {
    "Use somente um modo de piloto por vez."
}
if (atrioDesignPreview) {
    require(!atrioOtaQaLoopback && !atrioOtaPilotEnabled) {
        "Previa de design nao pode coexistir com laboratorio OTA ou piloto Release."
    }
    require(gradle.startParameter.taskNames.all { task ->
        task.substringAfterLast(':').lowercase() in setOf("assembledebug", "clean")
    }) {
        "Previa de design: somente assembleDebug e clean sao permitidos."
    }
    require(listOf(
        "ATRIO_PUSH_WORKER_URL", "ATRIO_GUARDIAN_V2_WORKER_URL",
        "ATRIO_AVATAR_WORKER_URL", "ATRIO_SIGNING_STORE_FILE",
        "ATRIO_SIGNING_STORE_PASSWORD", "ATRIO_SIGNING_KEY_ALIAS",
        "ATRIO_SIGNING_KEY_PASSWORD"
    ).all { System.getenv(it).isNullOrBlank() }) {
        "A previa de design nao aceita endpoints, credenciais nem assinatura de producao."
    }
}
if (atrioOtaReleasePilot) {
    require(System.getenv("ATRIO_OTA_PILOT_CONFIRM") == "HOMOLOGAR ATRIO SEM PUBLICAR") {
        "Confirmacao explicita para gerar candidato de homologacao ausente."
    }
    require(gradle.startParameter.taskNames.isNotEmpty() &&
        gradle.startParameter.taskNames.all { task ->
            task.substringAfterLast(':') == "assembleOtaPilot"
        }) { "Candidato piloto so pode ser gerado exclusivamente por :app:assembleOtaPilot." }
}
val atrioPilotCode = (System.getenv("ATRIO_OTA_PILOT_VERSION_CODE") ?: "36").toIntOrNull()
    ?: error("versionCode do piloto invalido")
val atrioPilotName = System.getenv("ATRIO_OTA_PILOT_VERSION_NAME") ?: "0.20.1"
require(atrioPilotCode >= 36 && Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(atrioPilotName)) {
    "Piloto exige versao posterior ao Release historico 0.20.0/code35."
}
if (atrioOtaQaLoopback && gradle.startParameter.taskNames.any { task ->
    val name = task.substringAfterLast(':').lowercase()
    name.contains("release") || name == "assemble" || name == "build" || name == "bundle"
}) {
    error("O laboratorio OTA isolado nunca pode compilar APK ou bundle Release.")
}
// Com app/google-services.json presente, o Google Services gera os recursos Firebase.
// Sem o arquivo, este projeto ainda pode ser compilado em modo demonstração.
if ((file("google-services.json").exists() || atrioPerfilQaBuild || atrioChatQaBuild ||
        atrioQaGeralRemote) && !atrioOtaQaLoopback && !atrioDesignPreview) {
    apply(plugin = "com.google.gms.google-services")
}

// Dados de assinatura chegam somente como variaveis de ambiente do CI.
// Sem eles, o build debug continua identico e o release nao e assinado.
val atrioStoreFile = System.getenv("ATRIO_SIGNING_STORE_FILE")
val atrioStorePassword = System.getenv("ATRIO_SIGNING_STORE_PASSWORD")
val atrioKeyAlias = System.getenv("ATRIO_SIGNING_KEY_ALIAS")
val atrioKeyPassword = System.getenv("ATRIO_SIGNING_KEY_PASSWORD")
if (atrioOtaReleasePilot) {
    require(listOf(atrioStoreFile, atrioStorePassword, atrioKeyAlias, atrioKeyPassword)
        .all { !it.isNullOrBlank() }) {
        "Piloto real exige certificado oficial e assinatura permanente; nao aceitar APK unsigned."
    }
}

// Versão do APK de testes: avançar para 2, 3, ... a cada NOVA atualização Debug.
// Candidato OTA publico 0.20.4 / versionCode 39; manter aprovacao manual, certificado permanente e mesmo applicationId.
// Laboratorio OTA: apenas Debug construido deliberadamente com esta variavel.
// O piloto Release é outro buildType, habilitado somente por confirmacao manual.
val atrioDebugPatch = 10
val atrioDebugVersionName = "0.19.$atrioDebugPatch"
val atrioDebugVersionCode = 27 + atrioDebugPatch

android {
    namespace = "br.com.atriocatolico"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.com.atriocatolico"
        testInstrumentationRunner = "br.com.atriocatolico.QaAndroidTestRunner"
        minSdk = 26
        targetSdk = 35
        versionCode = 39
        versionName = "0.20.4"
        buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"0.20.4\"")
        buildConfigField("boolean", "ATRIO_QA_GERAL_REMOTE", "false")
        buildConfigField("boolean", "ATRIO_QA_GERAL_CELULAR_FICTICIO", "false")
        buildConfigField("int", "ATRIO_QA_GERAL_CELULAR_PAIR_CODE", "0")
        buildConfigField("boolean", "ATRIO_QA_GERAL_PUSH", "false")
        buildConfigField("String", "ATRIO_QA_GERAL_PROJECT_ID", "\"\"")
        buildConfigField("String", "ATRIO_QA_GERAL_APP_ID", "\"\"")
        val relayUrl = System.getenv("ATRIO_PUSH_WORKER_URL").orEmpty()
        val allowed = Regex("^https://[a-zA-Z0-9-]+\\.[a-zA-Z0-9-]+\\.workers\\.dev$")
        require(relayUrl.isBlank() || allowed.matches(relayUrl)) { "ATRIO_PUSH_WORKER_URL invalida" }
        buildConfigField("String", "PUSH_RELAY_URL", "\"$relayUrl\"")
        // O V2 nunca reutiliza o Worker de push V1; por padrão está desabilitado.
        val guardianV2Url = System.getenv("ATRIO_GUARDIAN_V2_WORKER_URL").orEmpty()
        require(guardianV2Url.isBlank() || allowed.matches(guardianV2Url)) {
            "ATRIO_GUARDIAN_V2_WORKER_URL invalida"
        }
        buildConfigField("String", "GUARDIAN_V2_WORKER_URL", "\"$guardianV2Url\"")
        val avatarUrl = System.getenv("ATRIO_AVATAR_WORKER_URL").orEmpty()
        require(avatarUrl.isBlank() || allowed.matches(avatarUrl)) { "ATRIO_AVATAR_WORKER_URL invalida" }
        buildConfigField("String", "AVATAR_WORKER_URL", "\"$avatarUrl\"")
    }

    signingConfigs {
        if (listOf(atrioStoreFile, atrioStorePassword, atrioKeyAlias, atrioKeyPassword)
                .all { !it.isNullOrBlank() }) {
            create("atrioRelease") {
                storeFile = file(atrioStoreFile!!)
                storePassword = atrioStorePassword!!
                keyAlias = atrioKeyAlias!!
                keyPassword = atrioKeyPassword!!
            }
        }
    }

    buildTypes {
        getByName("debug") {
            buildConfigField("boolean", "OTA_QA_LOOPBACK", atrioOtaQaLoopback.toString())
            buildConfigField("boolean", "OTA_RELEASE_PILOT_LOOPBACK", "false")
            // Instala lado a lado do app oficial: jamais substituir o Debug usual.
            if (atrioOtaQaLoopback) applicationIdSuffix = ".otalab"
            if (atrioDesignPreview) {
                // Identificador EXCLUSIVO para instalar junto ao aplicativo oficial.
                // Nao substitui nem recebe os dados de br.com.atriocatolico.
                applicationIdSuffix = ".v2preview"
            }
            // A numeração de testes aparece também dentro da aba Perfil.
            buildConfigField(
                "String", "ATRIO_VISIBLE_VERSION",
                if (atrioDesignPreview) "\"Design v2 • demonstração local\""
                else "\"$atrioDebugVersionName\""
            )
        }
        getByName("release") {
            buildConfigField("boolean", "OTA_QA_LOOPBACK", "false")
            buildConfigField("boolean", "OTA_RELEASE_PILOT_LOOPBACK", "false")
            // Modo publico com moderacao humana: nao conectar o APK ao
            // gateway Guardiao V2 nao homologado. Denuncias e painel de
            // moderacao humana no Firestore permanecem disponiveis.
            if (System.getenv("ATRIO_RELEASE_MODERATION_MODE") == "human") {
                buildConfigField("String", "GUARDIAN_V2_WORKER_URL", "\"\"")
            }
            signingConfigs.findByName("atrioRelease")?.let { signingConfig = it }
        }
        create("chatQa") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".chatqa"
            matchingFallbacks += listOf("debug")
            isDebuggable = true
            buildConfigField("boolean", "OTA_QA_LOOPBACK", "false")
            buildConfigField("boolean", "OTA_RELEASE_PILOT_LOOPBACK", "false")
            buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"Chat QA isolado\"")
            buildConfigField("String", "PUSH_RELAY_URL",
                "\"" + System.getenv("ATRIO_CHAT_QA_WORKER_URL").orEmpty() + "\"")
            buildConfigField("String", "GUARDIAN_V2_WORKER_URL", "\"\"")
            buildConfigField("String", "AVATAR_WORKER_URL", "\"\"")
        }
        create("qaGeral") {
            initWith(getByName("debug"))
            if (atrioQaGeralCelularUnsigned) signingConfig = null
            applicationIdSuffix = atrioQaGeralPackageSuffix
            matchingFallbacks += listOf("debug")
            isDebuggable = true
            buildConfigField("boolean", "OTA_QA_LOOPBACK", "false")
            buildConfigField("boolean", "OTA_RELEASE_PILOT_LOOPBACK", "false")
            val qaName = if (atrioQaGeralRemote) "QA Geral · Celular" else "QA Geral offline"
            manifestPlaceholders["atrioQaGeralLabel"] = when {
                atrioQaGeralCelularPairCode.isNotEmpty() -> "Átrio QA Celular · Atualização"
                atrioQaGeralRemote -> "Átrio Católico · QA Geral Celular"
                else -> "Átrio Católico · QA Geral"
            }
            buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"$qaName\"")
            if (atrioQaGeralRemote) {
                buildConfigField("boolean", "ATRIO_QA_GERAL_REMOTE", "true")
                buildConfigField("boolean", "ATRIO_QA_GERAL_CELULAR_FICTICIO", atrioQaGeralCelularFicticio.toString())
                buildConfigField("int", "ATRIO_QA_GERAL_CELULAR_PAIR_CODE", atrioQaGeralCelularPairCode.ifEmpty { "0" })
                buildConfigField("boolean", "ATRIO_QA_GERAL_PUSH", atrioQaGeralPush.toString())
                buildConfigField("String", "ATRIO_QA_GERAL_PROJECT_ID", "\"$atrioQaGeralRemoteProject\"")
                buildConfigField("String", "ATRIO_QA_GERAL_APP_ID", "\"$atrioQaGeralRemoteAppId\"")
            }
            buildConfigField("String", "PUSH_RELAY_URL", "\"\"")
            buildConfigField("String", "GUARDIAN_V2_WORKER_URL", "\"\"")
            buildConfigField("String", "AVATAR_WORKER_URL", "\"\"")
        }
        create("perfilQa") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".perfilqa"
            matchingFallbacks += listOf("debug")
            isDebuggable = true
            buildConfigField("boolean", "OTA_QA_LOOPBACK", "false")
            buildConfigField("boolean", "OTA_RELEASE_PILOT_LOOPBACK", "false")
            buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"Perfil QA isolado\"")
            // Somente Firestore/Auth de QA; nunca relays oficiais.
            buildConfigField("String", "PUSH_RELAY_URL", "\"\"")
            buildConfigField("String", "GUARDIAN_V2_WORKER_URL", "\"\"")
            buildConfigField("String", "AVATAR_WORKER_URL", "\"\"")
        }
        create("otaPilot") {
            initWith(getByName("release"))
            // Mesmo applicationId oficial: preserva dados e sessao durante A -> B.
            // Nada de applicationIdSuffix, debug ou bypass do certificado oficial.
            isDebuggable = false
            matchingFallbacks += listOf("release")
            buildConfigField("boolean", "OTA_QA_LOOPBACK", "false")
            buildConfigField("boolean", "OTA_RELEASE_PILOT_LOOPBACK", "true")
            buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"$atrioPilotName\"")
            signingConfigs.findByName("atrioRelease")?.let { signingConfig = it }
        }
    }

    if (atrioQaGeralCelularFicticio) {
        sourceSets.getByName("qaGeral").manifest.srcFile("src/qaGeral/AndroidManifest.ficticio.xml")
    } else if (atrioQaGeralPush) {
        sourceSets.getByName("qaGeral").manifest.srcFile("src/qaGeral/AndroidManifest.push.xml")
    }

    // Instrumentacao em qaGeral so com opt-in; Debug oficial permanece normal.
    testBuildType = if (atrioQaGeralBuild) "qaGeral" else "debug"

    buildFeatures { compose = true; buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}

// APK QA Geral desligado em builds comuns e em release.
androidComponents {
    beforeVariants(selector().withBuildType("qaGeral")) { variant ->
        variant.enable = atrioQaGeralBuild
    }
    onVariants(selector().withBuildType("qaGeral")) { variant ->
        variant.outputs.forEach { output ->
            val suffix = if (atrioQaGeralRemote) "qa-geral-celular" else "qa-geral"
            val pairSuffix = if (atrioQaGeralCelularPairCode.isEmpty()) "" else "-$atrioQaGeralCelularPairCode"
            output.versionName.set("$atrioDebugVersionName-$suffix$pairSuffix")
            output.versionCode.set(atrioQaGeralCelularPairCode.toIntOrNull() ?: atrioDebugVersionCode)
        }
    }
}

// O chat de homologacao nunca participa de builds normais.
androidComponents {
    beforeVariants(selector().withBuildType("chatQa")) { variant ->
        variant.enable = atrioChatQaBuild
    }
    onVariants(selector().withBuildType("chatQa")) { variant ->
        variant.outputs.forEach { output ->
            output.versionName.set(atrioDebugVersionName)
            output.versionCode.set(atrioDebugVersionCode)
        }
    }
}

// Variante Perfil QA desabilitada em builds comuns e release.
androidComponents {
    beforeVariants(selector().withBuildType("perfilQa")) { variant ->
        variant.enable = atrioPerfilQaBuild
    }
    onVariants(selector().withBuildType("perfilQa")) { variant ->
        variant.outputs.forEach { output ->
            output.versionName.set(atrioDebugVersionName)
            output.versionCode.set(atrioDebugVersionCode)
        }
    }
}

// Esta variante nao participa de builds comuns nem de Releases oficiais.
androidComponents {
    beforeVariants(selector().withBuildType("otaPilot")) { variant ->
        variant.enable = atrioOtaPilotEnabled
    }
    onVariants(selector().withBuildType("otaPilot")) { variant ->
        variant.outputs.forEach { output ->
            output.versionName.set(atrioPilotName)
            output.versionCode.set(atrioPilotCode)
        }
    }
}

// Alterar somente os metadados do APK Debug via API oficial de variantes AGP.
// O Android permite instalar atualizações quando versionCode cresce e a assinatura coincide.
androidComponents {
    onVariants(selector().withBuildType("debug")) { variant ->
        variant.outputs.forEach { output ->
            output.versionName.set(atrioDebugVersionName)
            output.versionCode.set(atrioDebugVersionCode)
        }
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation(platform("com.google.firebase:firebase-bom:35.0.2"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.android.gms:play-services-base:18.11.1")
    implementation("androidx.work:work-runtime:2.11.2")
    implementation("androidx.core:core:1.16.0") // Compartilhar APK privado com instalador Android
    val composeBom = platform("androidx.compose:compose-bom:2025.12.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    // Custom buildType nao herda dependencies de debugImplementation.
    // A Activity sintetica e necessaria a createAndroidComposeRule<ComponentActivity>().
    add("qaGeralImplementation", "androidx.compose.ui:ui-test-manifest")

    // Somente APK instrumentation de teste: nunca integra a versão publicada.
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
}


kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}


