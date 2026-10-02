import java.util.Properties

plugins {
    id("musix.android.application")
    id("musix.android.compose")
    id("musix.hilt")
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.baselineprofile)
}

// Release signing lives OUTSIDE the repo (the 1.0.0 key: v2 must install over it)
val keyProps = Properties().apply {
    val f = file(System.getenv("MUSIX_KEYSTORE_PROPERTIES") ?: "/mnt/data/android/keys/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    defaultConfig {
        applicationId = "ru.musixai.app"
        targetSdk = 36  // 37 once its behaviour changes are reviewed
        // Bump BOTH for every APK handed out; 1.0.0 was versionCode 1
        versionCode = 7
        versionName = "2.0.5"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        create("release") {
            if (keyProps["storeFile"] != null) {
                storeFile = file(keyProps["storeFile"] as String)
                storePassword = keyProps["storePassword"] as String
                keyAlias = keyProps["keyAlias"] as String
                keyPassword = keyProps["keyPassword"] as String
            }
        }
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".dev"  // coexists with 1.0.0 / a release install
            versionNameSuffix = "-dev"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = if (keyProps["storeFile"] != null) signingConfigs["release"] else null
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures { buildConfig = true }
    packaging { resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/OSGI-INF/MANIFEST.MF") }
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:model"))
    implementation(project(":core:network"))
    implementation(project(":core:data"))
    implementation(project(":core:designsystem"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:home"))
    implementation(project(":feature:player"))
    implementation(project(":feature:library"))
    implementation(project(":feature:search"))
    implementation(project(":feature:artist"))
    implementation(project(":feature:settings"))
    implementation(project(":feature:imports"))
    implementation(project(":feature:upload"))
    implementation(project(":feature:quiz"))
    implementation(project(":feature:stats"))
    implementation(project(":feature:assistant"))
    implementation(project(":core:player"))
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.navigation.compose)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.profileinstaller)
    baselineProfile(project(":benchmark"))
    implementation(libs.serialization.json)
    implementation(project(":core:database"))
    implementation(libs.work.runtime)
    implementation(libs.hilt.work)
    implementation(libs.lifecycle.process)
    implementation(libs.glance.appwidget)  // home screen widgets (phase 8 §3)
    // instrumented checks on the emulator (Android Auto's browse tree, phase 8 §2)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.junit)
}
