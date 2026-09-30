package ru.musixai.app.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OutboxTest {
    @Test
    fun `offline edits replay in order after a failure and resend the same client ids`() = runTest {
        val seen = mutableListOf<Pair<String, String>>()
        var failItems = 1
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = request.url.encodedPath
                    seen += path to request.body!!.utf8()
                    if (path.endsWith("/items") && failItems-- > 0) return MockResponse(503)
                    return MockResponse(200, body = if (path.endsWith("listens:batch")) """{"accepted":2,"duplicates":0,"rejected":[]}""" else "{}")
                }
            }
            start()
        }
        val h = Harness(server)
        val outbox = Outbox(h.db.outbox(), h.api)
        val playlists = PlaylistRepository(h.db, outbox)
        // made offline: a playlist, two tracks in it, then two listens
        val pid = playlists.create("Road")
        val items = playlists.add(pid, listOf("5b1e7c0e-0000-4000-8000-00000000000a", "5b1e7c0e-0000-4000-8000-00000000000b"))
        for (i in 1..2) outbox.enqueue(Outbox.LISTEN, "listen:$i", buildJsonObject { put("clientEventId", "e$i"); put("playedMs", 1000) })

        assertTrue(outbox.flush() is Outbox.Flush.Retry)  // the items call fails: it and the listens wait
        assertEquals(listOf("/api/v2/playlists", "/api/v2/playlists/$pid/items"), seen.map { it.first })
        assertEquals(Outbox.Flush.Done, outbox.flush())
        val paths = seen.map { it.first }
        assertEquals(listOf("/api/v2/playlists", "/api/v2/playlists/$pid/items", "/api/v2/playlists/$pid/items", "/api/v2/events/listens:batch"), paths)
        assertEquals(seen[1].second, seen[2].second)  // the replay carries the same item ids and order keys
        items.forEach { assertTrue(seen[2].second.contains(it)) }
        assertTrue(seen[3].second.contains("\"e1\"") && seen[3].second.contains("\"e2\""))  // one batch
        assertEquals(0, outbox.pending.first())
        assertEquals(2, h.db.playlists().itemsNow(pid).size)  // the local state was there all along
        h.close()
    }
}
