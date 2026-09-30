plugins {
    id("musix.android.library")
    id("musix.hilt")
    alias(libs.plugins.room)
}

room { schemaDirectory("$projectDir/schemas") }

dependencies {
    implementation(project(":core:model"))
    api(libs.room.runtime)
    api(libs.room.ktx)
    api(libs.room.paging)
    ksp(libs.room.compiler)
}
