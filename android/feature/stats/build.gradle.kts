plugins { id("musix.android.feature") }

dependencies {
    implementation(project(":core:network"))  // the generated stats models are the UI state as-is
}
