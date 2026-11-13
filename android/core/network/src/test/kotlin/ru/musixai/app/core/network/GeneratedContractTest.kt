package ru.musixai.app.core.network

import app.musix.api.models.LibrarySummaryOut
import java.time.OffsetDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

class GeneratedContractTest {
    @Test fun nestedDatesInLibrarySummaryKeepTheirWireFormat() {
        val wire = """{
            "counts":{"albums":1,"artists":1,"playlists":0,"tracks":1},
            "durationMs":240000,"firstAddedAt":"2026-10-01T12:30:00+03:00",
            "genres":[],"lastAddedAt":null,"playedMs":120000,"plays":1,
            "albumLast":{"album-1":"2026-11-13T04:15:30Z"}
        }"""
        val summary = ApiJson.decodeFromString(LibrarySummaryOut.serializer(), wire)
        assertEquals(OffsetDateTime.parse("2026-11-13T04:15:30Z"), summary.albumLast?.get("album-1"))
        assertEquals(OffsetDateTime.parse("2026-10-01T12:30:00+03:00"), summary.firstAddedAt)
        val encoded = ApiJson.encodeToString(LibrarySummaryOut.serializer(), summary)
        assertEquals(summary, ApiJson.decodeFromString(LibrarySummaryOut.serializer(), encoded))
    }
}
