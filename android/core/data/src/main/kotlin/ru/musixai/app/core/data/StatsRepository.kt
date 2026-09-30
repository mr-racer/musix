package ru.musixai.app.core.data

import app.musix.api.models.StatsOut
import app.musix.api.models.TasteMapOut
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.mapNotNull
import ru.musixai.app.core.database.KvEntity
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.network.ApiJson
import ru.musixai.app.core.network.MusixApi
import javax.inject.Inject
import javax.inject.Singleton

/** `/stats` and `/stats/map`, last answers kept in Room (the tab opens instantly). */
@Singleton
class StatsRepository @Inject constructor(private val api: MusixApi, private val db: MusixDatabase) {
    val stats: Flow<StatsOut> = db.mirror().kvFlow(STATS).mapNotNull { r -> r?.let { runCatching { ApiJson.decodeFromString(StatsOut.serializer(), it) }.getOrNull() } }
    val map: Flow<TasteMapOut> = db.mirror().kvFlow(MAP).mapNotNull { r -> r?.let { runCatching { ApiJson.decodeFromString(TasteMapOut.serializer(), it) }.getOrNull() } }

    suspend fun refresh() {
        val tz = java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
        val s = api.call { screens.statsTabApiV2StatsGet(tz) }
        db.mirror().putKv(KvEntity(STATS, ApiJson.encodeToString(StatsOut.serializer(), s)))
        runCatching { api.call { screens.tasteMapApiV2StatsMapGet() } }.getOrNull()?.let {
            db.mirror().putKv(KvEntity(MAP, ApiJson.encodeToString(TasteMapOut.serializer(), it)))
        }
    }

    private companion object { const val STATS = "screen.stats"; const val MAP = "screen.map" }
}
