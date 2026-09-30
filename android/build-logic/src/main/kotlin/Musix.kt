import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.dsl.CommonExtension
import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.jetbrains.kotlin.compose.compiler.gradle.ComposeCompilerGradlePluginExtension
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension

private val Project.libs: VersionCatalog get() = extensions.getByType(VersionCatalogsExtension::class.java).named("libs")

private fun Project.lib(alias: String): Any = libs.findLibrary(alias).get().get()

private fun Project.dep(conf: String, notation: Any) { dependencies.add(conf, notation) }

/** ":core:network" → "ru.musixai.app.core.network" */
private fun Project.musixNamespace(): String = "ru.musixai.app" + path.replace(":", ".").replace("-", "")

private val Project.android: CommonExtension get() = extensions.getByType(CommonExtension::class.java)

/** The settings every Android module shares: SDK levels, Java 21, Kotlin's JVM target. */
private fun Project.configureAndroid() {
    android.apply {
        compileSdk = 37
        defaultConfig.minSdk = 24  // = 1.0.0: v2 installs over it on the same phones
        compileOptions.sourceCompatibility = JavaVersion.VERSION_21
        compileOptions.targetCompatibility = JavaVersion.VERSION_21
        testOptions.unitTests.isIncludeAndroidResources = true
        testOptions.unitTests.isReturnDefaultValues = true
    }
    extensions.getByType(KotlinAndroidProjectExtension::class.java).compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.addAll("-opt-in=kotlinx.coroutines.ExperimentalCoroutinesApi")
    }
    dep("implementation", lib("coroutines-android"))
    dep("testImplementation", lib("junit"))
    dep("testImplementation", lib("coroutines-test"))
    // most modules have no JVM tests (the ~100-test budget): an empty test task is not a failure
    tasks.withType(org.gradle.api.tasks.testing.Test::class.java).configureEach { it.failOnNoDiscoveredTests.set(false) }
}

class LibraryConvention : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.android.library")  // AGP 9 compiles Kotlin itself
        extensions.getByType(LibraryExtension::class.java).namespace = musixNamespace()
        configureAndroid()
        dep("testImplementation", lib("robolectric"))
        dep("testImplementation", lib("androidx-test-core"))
    }
}

class ApplicationConvention : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.android.application")
        extensions.getByType(ApplicationExtension::class.java).namespace = "ru.musixai.app"
        configureAndroid()
    }
}

class ComposeConvention : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
        android.buildFeatures.compose = true
        // core:model has no Compose dependency: its immutable data classes are declared stable here
        extensions.getByType(ComposeCompilerGradlePluginExtension::class.java).stabilityConfigurationFiles
            .add(rootProject.layout.projectDirectory.file("compose-stability.conf"))
        val bom = dependencies.platform(lib("compose-bom"))
        dep("implementation", bom)
        for (a in listOf("compose-ui", "compose-foundation", "compose-animation", "compose-material3", "compose-ui-tooling-preview")) {
            dep("implementation", lib(a))
        }
        dep("debugImplementation", lib("compose-ui-tooling"))
        dep("testImplementation", bom)
        dep("testImplementation", lib("compose-ui-test"))
        dep("debugImplementation", lib("compose-ui-test-manifest"))
    }
}

class HiltConvention : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.google.devtools.ksp")
        pluginManager.apply("com.google.dagger.hilt.android")
        dep("implementation", lib("hilt-android"))
        dep("ksp", lib("hilt-compiler"))
    }
}

/** A screen: Compose + Hilt ViewModels + the core modules every surface reads. */
class FeatureConvention : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("musix.android.library")
        pluginManager.apply("musix.android.compose")
        pluginManager.apply("musix.hilt")
        pluginManager.apply("io.github.takahirom.roborazzi")
        for (p in listOf(":core:common", ":core:model", ":core:data", ":core:designsystem")) dep("implementation", project(p))
        for (a in listOf("lifecycle-runtime-compose", "lifecycle-viewmodel-compose", "hilt-navigation-compose", "navigation-compose", "serialization-json")) {
            dep("implementation", lib(a))
        }
        dep("testImplementation", project(":core:testing"))
    }
}
