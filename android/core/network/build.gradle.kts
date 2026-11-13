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
tasks.named("openApiGenerate") {
    val models = generated.get().dir("src/main/kotlin/app/musix/api/models").asFile
    // The generator annotates a whole Map with @Contextual, but its date-valued
    // elements still need a serializer. A file-level declaration also covers nested
    // collections while retaining the existing java.time API and wire format.
    doLast {
        models.walkTopDown()
            .filter { it.extension == "kt" }.forEach { model ->
                val source = model.readText()
                val annotation = "@file:kotlinx.serialization.UseContextualSerialization(java.time.OffsetDateTime::class, java.time.LocalDate::class, java.util.UUID::class)\n\n"
                if (!source.startsWith(annotation)) model.writeText(annotation + source)
            }
    }
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
