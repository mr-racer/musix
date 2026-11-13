plugins {
    id("musix.android.library")
    id("musix.android.compose")
    id("io.github.takahirom.roborazzi")
}

// MusixTheme.kt is GENERATED from design/tokens by design/gen/build.py (make design)
val tokens = rootProject.layout.projectDirectory.dir("../design/gen/android").asFile.path
androidComponents.onVariants { it.sources.kotlin?.addStaticSourceDirectory(tokens) }

dependencies {
    implementation(project(":core:model"))
    api(libs.coil.compose)
    api(libs.haze)
    api(libs.haze.glass)
    implementation(libs.graphics.shapes)
    api(libs.reorderable)
    implementation(libs.coil.okhttp)
    testImplementation(project(":core:testing"))
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
}
