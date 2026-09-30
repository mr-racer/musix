plugins {
    id("musix.android.library")
    id("musix.hilt")
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi)
}

// The v2 client, generated from the contract at build time (never committed), with the
// phase 1 generator config: jvm-okhttp4 + kotlinx.serialization.
val contracts = rootProject.layout.projectDirectory.dir("../contracts")
val generated = layout.buildDirectory.dir("generated/openapi")
openApiGenerate {
    generatorName.set("kotlin")
    inputSpec.set(contracts.file("openapi.json").asFile.path)
    configFile.set(contracts.file("codegen/kotlin/config.yaml").asFile.path)
    outputDir.set(generated.get().asFile.path)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
    generateApiTests.set(false)
    generateModelTests.set(false)
}
androidComponents.onVariants { v ->
    v.sources.kotlin?.addStaticSourceDirectory(generated.get().dir("src/main/kotlin").asFile.path)
}
tasks.named("preBuild") { dependsOn("openApiGenerate") }

dependencies {
    implementation(project(":core:common"))
    api(libs.okhttp)
    api(libs.serialization.json)
    implementation(libs.datastore)
    testImplementation(libs.okhttp.mockwebserver)
}
