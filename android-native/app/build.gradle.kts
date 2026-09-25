import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val local = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
val desktopEnv = Properties().apply {
    rootProject.file("../.env").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun setting(name: String, desktopName: String): String = providers.environmentVariable(name).orNull
    ?: providers.gradleProperty(name).orNull ?: local.getProperty(name) ?: desktopEnv.getProperty(desktopName) ?: ""
fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
val supabaseUrl = setting("FOCAL_SUPABASE_URL", "VITE_SUPABASE_URL")
val supabaseKey = setting("FOCAL_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY")
require(supabaseUrl.isBlank() || supabaseUrl.startsWith("https://")) { "Focal Supabase URL must use HTTPS" }
require(!supabaseKey.startsWith("sb_secret_") && !supabaseKey.startsWith("sb_service_role_")) { "Use a publishable or anon key" }
val appVersion = Regex("\"version\"\\s*:\\s*\"(\\d+)\\.(\\d+)\\.(\\d+)\"")
    .find(rootProject.file("../package.json").readText()) ?: error("package.json needs a numeric app version")
val (major, minor, patch) = appVersion.destructured
require(minor.toInt() < 1000 && patch.toInt() < 1000 && major.toInt() <= 2100) { "Android version code overflow" }
val signingValues = listOf("ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
    .associateWith { providers.environmentVariable(it).orNull.orEmpty() }
if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) })
    require(signingValues.values.all(String::isNotBlank)) { "Release builds require all ANDROID_KEYSTORE_* variables" }

android {
    namespace = "com.andy.focal"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.andy.focal.android"
        minSdk = 26
        targetSdk = 35
        versionCode = major.toInt() * 1_000_000 + minor.toInt() * 1_000 + patch.toInt()
        versionName = "$major.$minor.$patch"
        buildConfigField("String", "SUPABASE_URL", quoted(supabaseUrl))
        buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", quoted(supabaseKey))
    }
    buildFeatures { compose = true; buildConfig = true }
    // ponytail: these library detectors crash with Kotlin 2.1 analysis; keep all other lint checks.
    lint { disable += listOf("NullSafeMutableLiveData", "FrequentlyChangingValue", "RememberInComposition", "AutoboxingStateCreation") }
    signingConfigs {
        create("focalRelease") {
            if (signingValues.values.all(String::isNotBlank)) {
                storeFile = file(signingValues.getValue("ANDROID_KEYSTORE_PATH"))
                storePassword = signingValues.getValue("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValues.getValue("ANDROID_KEY_ALIAS")
                keyPassword = signingValues.getValue("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("focalRelease") } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.compose.material3:material3:1.5.0-alpha01")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
