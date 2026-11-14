package ru.musixai.app.core.designsystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The library's layers (2026-11-14 spec §5.2, §5.6): a layer imports only the layers under it;
 * nothing in the library leans on `legacy`; outside it, only today's v1 users may — and that
 * list only shrinks.
 */
class LayerRulesTest {
    private val pkg = "ru.musixai.app.core.designsystem"
    private val src = File("src/main/kotlin/ru/musixai/app/core/designsystem")
    private val android = File("../..")

    /** The root package is the foundation (the generated MusixTheme.kt lives there too). */
    private val rank = mapOf("" to 0, "motion" to 1, "gesture" to 2, "surface" to 3, "control" to 3, "content" to 4)

    private fun layerOf(path: String): String = path.removePrefix("$pkg").removePrefix(".").substringBefore('.').let {
        if (it.isEmpty() || it.first().isUpperCase() || it !in rank.keys + "legacy") "" else it
    }

    private fun imports(f: File) = f.readLines().filter { it.startsWith("import $pkg") }.map { it.removePrefix("import ").trim() }

    @Test fun aLayerImportsOnlyTheLayersUnderIt() {
        val wrong = src.walkTopDown().filter { it.extension == "kt" }.flatMap { f ->
            val own = f.parentFile.relativeTo(src).path.substringBefore('/')
            if (own == "legacy") return@flatMap emptySequence()
            // surface and control are peers: each may use the other
            imports(f).asSequence().map { layerOf(it) }.filter { to -> to == "legacy" || rank.getValue(to) > rank.getValue(own) }
                .map { "${f.name} ($own) → $it" }
        }.toList()
        assertTrue("layer breaches: $wrong", wrong.isEmpty())
    }

    /** v1 users as of 2026-11-14. A screen that moves to the library leaves the list; nothing joins it. */
    private val legacyUsers = setOf(
        "app/src/main/kotlin/ru/musixai/app/ui/MusixApp.kt",
        "feature/artist/src/main/kotlin/ru/musixai/app/feature/artist/ArtistHero.kt",
        "feature/artist/src/main/kotlin/ru/musixai/app/feature/artist/ArtistScreen.kt",
        "feature/auth/src/main/kotlin/ru/musixai/app/feature/auth/LoginScreen.kt",
        "feature/imports/src/main/kotlin/ru/musixai/app/feature/imports/ImportScreen.kt",
        "feature/library/src/main/kotlin/ru/musixai/app/feature/library/Detail.kt",
        "feature/library/src/main/kotlin/ru/musixai/app/feature/library/LibraryScreen.kt",
        "feature/player/src/main/kotlin/ru/musixai/app/feature/player/AddToPlaylist.kt",
        "feature/player/src/main/kotlin/ru/musixai/app/feature/player/FactsAndQueue.kt",
        "feature/player/src/main/kotlin/ru/musixai/app/feature/player/PlayerParts.kt",
        "feature/player/src/main/kotlin/ru/musixai/app/feature/player/PlayerScreen.kt",
        "feature/quiz/src/main/kotlin/ru/musixai/app/feature/quiz/QuizScreen.kt",
        "feature/search/src/main/kotlin/ru/musixai/app/feature/search/SearchScreen.kt",
        "feature/settings/src/main/kotlin/ru/musixai/app/feature/settings/SettingsScreen.kt",
        "feature/stats/src/main/kotlin/ru/musixai/app/feature/stats/Collection.kt",
        "feature/stats/src/main/kotlin/ru/musixai/app/feature/stats/StatsScreen.kt",
        "feature/upload/src/main/kotlin/ru/musixai/app/feature/upload/UploadScreen.kt",
    )

    @Test fun onlyTodaysV1UsersImportLegacy() {
        val users = listOf("app", "feature").flatMap { dir ->
            File(android, dir).walkTopDown().filter { it.extension == "kt" && "/src/main/" in it.path && "/build/" !in it.path }
                .filter { f -> imports(f).any { layerOf(it) == "legacy" } }
                .map { it.relativeTo(android).path }.toList()
        }.toSet()
        assertTrue("new legacy users: ${users - legacyUsers}", (users - legacyUsers).isEmpty())
        assertEquals("moved off legacy — drop them from the list", emptySet<String>(), legacyUsers - users)
    }
}
