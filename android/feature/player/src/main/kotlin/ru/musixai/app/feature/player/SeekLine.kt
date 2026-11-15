package ru.musixai.app.feature.player

import androidx.compose.runtime.Composable
import ru.musixai.app.core.designsystem.control.PlayClock
import ru.musixai.app.core.designsystem.control.rememberPlayClock
import ru.musixai.app.core.model.SoundMoment

internal fun fmt(s: Double): String { val t = s.coerceAtLeast(0.0).toLong(); return "${t / 60}:${(t % 60).toString().padStart(2, '0')}" }

private val PLAIN_KINDS = setOf("bass_back", "beat_back", "beat_out", "bass_in")

/** The moments worth naming on the line: no plain «the beat is back», six at most, no «(…)» tails. */
internal fun lineMoments(all: List<SoundMoment>): List<SoundMoment> =
    all.filter { it.kind !in PLAIN_KINDS && "новая партия" !in it.label }.take(6).map { it.copy(label = it.label.replace(Regex("""\s*\(.*\)$"""), "")) }

/** The player's clock is the library's (the seek line moved there as `SongLine`, 2026-11-15). */
internal typealias Clock = PlayClock

/** A moment lit from outside the line: the library's. */
internal typealias LitMoment = ru.musixai.app.core.designsystem.control.LitMoment

@Composable
internal fun rememberClock(positionMs: Long, playing: Boolean, scrubbing: Boolean): Clock = rememberPlayClock(positionMs, playing, scrubbing)
