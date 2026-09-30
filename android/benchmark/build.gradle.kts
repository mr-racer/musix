plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.baselineprofile)
}

// Macrobenchmarks + the Baseline Profile generator, run against :app's `benchmark` build on a
// device or the Docker emulator (spec §8). Emulator numbers are marked as such in the report.
android {
    namespace = "ru.musixai.app.benchmark"
    compileSdk = 37
    defaultConfig {
        minSdk = 28
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        testInstrumentationRunnerArguments["androidx.benchmark.suppressErrors"] = "EMULATOR,DEBUGGABLE"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
    targetProjectPath = ":app"
    experimentalProperties["android.experimental.self-instrumenting"] = true
}

baselineProfile { useConnectedDevices = true }

dependencies {
    implementation(libs.benchmark.macro)
    implementation(libs.androidx.test.junit)
    implementation(libs.uiautomator)
}
