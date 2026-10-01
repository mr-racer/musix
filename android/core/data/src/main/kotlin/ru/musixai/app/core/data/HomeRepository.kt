package ru.musixai.app.core.data

import app.musix.api.models.HomeOut
import app.musix.api.models.ImageData
import app.musix.api.models.TrackOut
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import ru.musixai.app.core.database.KvEntity
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.model.ArtistRef
import ru.musixai.app.core.model.Counts
import ru.musixai.app.core.model.Home
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.model.Palette
import ru.musixai.app.core.model.Track
import ru.musixai.app.core.model.Vibe
import ru.musixai.app.core.model.WeeklyPulse
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import javax.inject.Inject
import javax.inject.Singleton

/** `GET /home` (the one BFF call of the home screen). The last answer is kept in Room, so
 *  a cold start renders at once and offline still shows the last home (spec §2). */
@Singleton
class HomeRepository @Inject constructor(private val api: MusixApi, private val db: MusixDatabase) {
    val home: Flow<Home> = db.mirror().kvFlow(KEY).mapNotNull { raw ->
        raw?.let { runCatching { ApiJson.decodeFromString(HomeOut.serializer(), it).model() }.getOrNull() }
    }

    suspend fun refresh() {
        val tz = java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
        val out = api.call { screens.homeApiV2HomeGet(tz) }
        db.mirror().putKv(KvEntity(KEY, ApiJson.encodeToString(HomeOut.serializer(), out)))
    }

    /** «Настроить волну»: the presets, in the server's order (both rows). */
    suspend fun presets(): List<ru.musixai.app.core.model.WavePreset> = api.call { stream.presetsApiV2StreamPresetsGet() }
        .sortedBy { it.position }.map { ru.musixai.app.core.model.WavePreset(it.id, it.row.value, it.labelRu) }

    /** The last choice made on this device: the server has no read of it, only the PUT. */
    val wave: Flow<Pair<String, String?>> = db.mirror().kvFlow(WAVE).map { raw ->
        val parts = raw?.split('|')
        (parts?.getOrNull(0)?.ifEmpty { null } ?: "mix") to parts?.getOrNull(1)?.ifEmpty { null }
    }

    suspend fun setWave(familiarity: String, sound: String?) {
        api.call { stream.settingsApiV2StreamSettingsPut(app.musix.api.models.StreamSettings(familiarity = familiarity, sound = sound)) }
        db.mirror().putKv(KvEntity(WAVE, "$familiarity|${sound.orEmpty()}"))
    }

    private companion object {
        const val KEY = "screen.home"
        const val WAVE = "wave.settings"
    }
}

internal fun TrackOut.model() = Track(
    id = id.toString(), title = titleDisplay ?: title, artist = artistDisplay,
    artists = artists.map { ArtistRef(it.id.toString(), it.name) }, albumId = albumId?.toString(), album = album, year = year,
    genre = genre, durationMs = (durationMs ?: 0).toLong(), trackNo = trackNo, discNo = discNo, coverImageId = coverImageId,
    addedAt = addedAt.toInstant().toEpochMilli(),
)

internal fun ImageData.model() = Image(
    id = id, blurhash = blurhash, width = width, height = height,
    palette = palette?.let { Palette(it.dominant, it.vibrant, it.muted, it.accent.dark, it.accent.light) },
    urls = urls.mapNotNull { (k, v) -> k.toIntOrNull()?.let { it to v } }.toMap(),
)

private fun HomeOut.model() = Home(
    vibes = vibes.map { v -> Vibe(v.id.toString(), v.name, v.tracks.map { it.model() }, v.weight.toDouble()) },
    wavePhrase = wave?.phrase,
    counts = Counts(counts.tracks, counts.albums, counts.artists, counts.playlists),
    pulse = pulse.let { WeeklyPulse(it.playedMs.toLong(), it.dailyMs.map { d -> d.toLong() }, it.discoveries, it.topGenre) },
    recent = recent.map { it.model() },
    recentlyAdded = recentlyAdded.map { it.model() },
    playlists = playlists.map { it.entity(0).model() },
    images = images.mapValues { it.value.model() },
)
