plugins {
    id("musix.android.library")
    id("musix.android.compose")
}

dependencies {
    api(libs.junit)
    api(libs.coroutines.test)
    api(libs.robolectric)
    api(libs.turbine)
    api(libs.androidx.test.core)
    api(libs.roborazzi)
    api(libs.roborazzi.compose)
    api(platform(libs.compose.bom))
    api(libs.compose.ui.test)
}
