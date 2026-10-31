plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Com app/google-services.json presente, o Google Services gera os recursos Firebase.
// Sem o arquivo, este projeto ainda pode ser compilado em modo demonstração.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Dados de assinatura chegam somente como variaveis de ambiente do CI.
// Sem eles, o build debug continua identico e o release nao e assinado.
val atrioStoreFile = System.getenv("ATRIO_SIGNING_STORE_FILE")
val atrioStorePassword = System.getenv("ATRIO_SIGNING_STORE_PASSWORD")
val atrioKeyAlias = System.getenv("ATRIO_SIGNING_KEY_ALIAS")
val atrioKeyPassword = System.getenv("ATRIO_SIGNING_KEY_PASSWORD")

// Versão do APK de testes: avançar para 2, 3, ... a cada NOVA atualização Debug.
// Release V2 autorizado: candidato 0.20.0 / versionCode 35. Assinatura permanece restrita ao workflow manual na main.
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
        // Google Play (outubro/2026) exige API 36 para novos envios e atualizacoes.
        // Validar edge-to-edge e regressao de notificacoes antes de integrar.
        targetSdk = 36
        versionCode = 35
        versionName = "0.20.0"
        buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"0.20.0\"")
        // Variante Play nunca baixa ou instala APKs fora da loja.
        buildConfigField("boolean", "PLAY_STORE_BUILD", "false")
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
            // A numeração de testes aparece também dentro da aba Perfil.
            buildConfigField("String", "ATRIO_VISIBLE_VERSION", "\"$atrioDebugVersionName\"")
        }
        getByName("release") {
            // Canal APK OTA: permanece com build/task/assinatura originais.
            signingConfigs.findByName("atrioRelease")?.let { signingConfig = it }
        }
        create("playRelease") {
            // Mesmo applicationId/versionCode, mas política de distribuição diferente.
            initWith(getByName("release"))
            matchingFallbacks += listOf("release")
            buildConfigField("boolean", "PLAY_STORE_BUILD", "true")
            signingConfigs.findByName("atrioRelease")?.let { signingConfig = it }
        }
    }

    buildFeatures { compose = true; buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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


