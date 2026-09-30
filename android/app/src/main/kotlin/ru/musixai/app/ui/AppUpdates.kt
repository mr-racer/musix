package ru.musixai.app.ui

import ru.musixai.app.core.data.Release

/** In-app update (spec §7) — the download + sha256 + PackageInstaller flow comes with the release block. */
object AppUpdates {
    var install: (Release) -> Unit = {}
}
