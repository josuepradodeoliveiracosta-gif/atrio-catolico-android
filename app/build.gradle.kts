plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// A QA OTA usa um pacote isolado .otalab e não toca Firebase de produção.
// Por isso NÃO aplica Google Services nesse build exclusivamente Debug.
val atrioOtaQaLoopback = System.getenv("ATRIO_OTA_QA_LOOPBACK") == "1"
// O piloto NÃO é uma publicacao: somente um buildType distinto, nao depuravel,
// com pacote e certificado oficiais. O modo normal fica completamente intocado.
val atrioOtaReleasePilot = System.getenv("ATRIO_OTA_RELEASE_PILOT") == "1"
val atrioOtaPilotCompileOnly = System.getenv("ATRIO_OTA_PILOT_COMPILE_ONLY") == "1"
val atrioOtaPilotEnabled = atrioOtaReleasePilot || atrioOtaPilotCompileOnly
require(!(atrioOtaQaLoopback && atrioOtaPilotEnabled)) {
    "Laboratorio Debug e piloto Release nao podem ser ativos juntos."
}
require(!(atrioOtaReleasePilot && atrioOtaPilotCompileOnly)) {
    "Use somente um modo de piloto por vez."
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
if (file("google-services.json").exists() && !atrioOtaQaLoopback) {
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
val atrioDebugPatch = 7
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
            // A numeração de testes aparece também dentro da aba Perfil.
            buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"$atrioDebugVersionName\"")
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

    buildFeatures { compose = true; buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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


