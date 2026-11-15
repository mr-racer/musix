package ru.musixai.app.core.model

/** A key the server explains in words (`SoundLabel`). */
data class SoundTag(val key: String, val label: String)

/** A part of the song's form, seconds. */
data class SoundSection(val start: Double, val end: Double, val kind: String, val label: String)

/** A moment worth hearing, seconds. */
data class SoundMoment(val t: Double, val kind: String, val label: String, val section: String)

/** Where a separated part stands in the mix: pan −1…1, width 0…1. */
data class StemPlace(val stem: String, val name: SoundTag, val side: SoundTag, val pan: Float, val width: Float)

/** The three absolute 0–100 scales; [space] is null for a mono file. */
data class SoundRatings(val tech: Int, val space: Int?, val odd: Int, val facets: Map<String, Map<String, Int>>)

/**
 * The live stage (`GET /tracks/{id}/sound/stage`): for every 1/[fps] s of the song, each stem's level
 * and place, `[frame][stem][level, pan]` — level in half-dB under the loudest stem frame (0…−120),
 * pan −100…100; [stems] in the server's order.
 */
class StageFrames(val fps: Int, val stems: List<String>, val frames: Int, val data: ByteArray) {
    /** dB under the loudest stem frame. */
    fun level(frame: Int, stem: Int): Float = data[(frame * stems.size + stem) * 2] / 2f
    /** −1 (left) … 1 (right). */
    fun pan(frame: Int, stem: Int): Float = data[(frame * stems.size + stem) * 2 + 1] / 100f
}

/** What the player shows about the sound of a track (`GET /tracks/{id}/sound`). */
data class TrackSound(
    val sections: List<SoundSection>,
    val moments: List<SoundMoment>,
    val stems: List<StemPlace>,
    val instruments: List<SoundTag>,
    val drums: SoundTag?,
    val vocals: SoundTag?,
    val echo: SoundTag,
    val width: SoundTag?,
    val feel: SoundTag?,
    val pace: SoundTag?,
    val ratings: SoundRatings,
    val hasStage: Boolean,
)
