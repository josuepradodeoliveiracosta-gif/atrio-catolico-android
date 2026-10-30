plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Independent APK: no Firebase SDK, Google Services plugin or Cloudflare.
// Compile the ACTUAL app classifier from a temporary Gradle generated copy.
val coreSource = layout.buildDirectory.dir("generated/guardianCore")
val copyCore by tasks.registering(Copy::class) {
    from(rootProject.file("app/src/main/java/br/com/atriocatolico/GuardianPreflight.kt"))
    from(rootProject.file("app/src/main/java/br/com/atriocatolico/GuardianUiPolicy.kt"))
    into(coreSource.map { it.dir("br/com/atriocatolico") })
}
android {
    namespace = "br.com.atriocatolico"
    compileSdk = 36
    defaultConfig {
        applicationId = "br.com.atriocatolico.guardianlab"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1-LAB"
    }
    sourceSets.getByName("main").java.srcDir(coreSource)
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    dependsOn(copyCore)
}
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.12.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    testImplementation("junit:junit:4.13.2")
}
