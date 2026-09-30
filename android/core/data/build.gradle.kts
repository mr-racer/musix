plugins {
    id("musix.android.library")
    id("musix.hilt")
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    api(project(":core:model"))
    api(project(":core:common"))
    implementation(project(":core:network"))
    implementation(project(":core:database"))
    api(libs.paging.runtime)
    implementation(libs.work.runtime)
    implementation(libs.hilt.work)
    ksp(libs.hilt.androidx.compiler)
    implementation(libs.datastore)
    implementation(libs.lifecycle.process)
    testImplementation(project(":core:testing"))
    testImplementation(libs.okhttp.mockwebserver)
}
