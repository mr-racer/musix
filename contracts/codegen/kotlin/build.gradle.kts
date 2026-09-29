plugins {
    kotlin("jvm") version "2.4.20"  // = the Android app
    kotlin("plugin.serialization") version "2.4.20"
}

kotlin {
    jvmToolchain(21)
    sourceSets["main"].kotlin.srcDir("generated/src/main/kotlin")
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
}
