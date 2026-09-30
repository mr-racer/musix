import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Binary convention plugins compiled by Kotlin 2.4 (not `kotlin-dsl`): Gradle 8.14 embeds
// Kotlin 2.0, which cannot read the 2.3 metadata of KSP and Roborazzi.
plugins {
    `java-gradle-plugin`
    kotlin("jvm") version "2.4.20"
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_21) } }
java { toolchain.languageVersion.set(JavaLanguageVersion.of(21)) }

dependencies {
    compileOnly(libs.android.gradle)
    compileOnly(libs.kotlin.gradle)
    compileOnly(libs.compose.gradle)
    compileOnly(libs.ksp.gradle)
    compileOnly(libs.hilt.gradle)
    compileOnly(libs.roborazzi.gradle)
}

gradlePlugin {
    plugins {
        register("library") { id = "musix.android.library"; implementationClass = "LibraryConvention" }
        register("application") { id = "musix.android.application"; implementationClass = "ApplicationConvention" }
        register("compose") { id = "musix.android.compose"; implementationClass = "ComposeConvention" }
        register("hilt") { id = "musix.hilt"; implementationClass = "HiltConvention" }
        register("feature") { id = "musix.android.feature"; implementationClass = "FeatureConvention" }
    }
}
