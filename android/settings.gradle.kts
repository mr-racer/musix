pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "musix"

include(":app")
include(":core:common", ":core:model", ":core:network", ":core:database", ":core:data", ":core:player",
        ":core:designsystem", ":core:testing")
include(":feature:auth", ":feature:home", ":feature:player", ":feature:library", ":feature:search",
        ":feature:artist", ":feature:settings", ":feature:imports", ":feature:upload", ":feature:quiz",
        ":feature:stats", ":feature:assistant")
