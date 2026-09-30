// Every plugin is resolved once, here, into the root classloader; build-logic only compiles
// against them (compileOnly), so AGP, Room and Hilt see each other's classes.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.compose) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.room) apply false
    alias(libs.plugins.openapi) apply false
    alias(libs.plugins.roborazzi) apply false
}
