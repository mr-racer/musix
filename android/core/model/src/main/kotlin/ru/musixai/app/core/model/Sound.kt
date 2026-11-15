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
