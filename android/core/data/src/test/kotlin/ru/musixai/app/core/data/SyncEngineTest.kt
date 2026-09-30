package ru.musixai.app.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SyncEngineTest {
    @Test
    fun `a paged snapshot mirrors the account and the next delta applies a delete`() = runTest {
        val page2 = resource("sync/page2.json")
        val gone = Regex("\"id\": \"([0-9a-f-]{36})\"").find(page2)!!.groupValues[1]  // the first track
        val cursors = mutableListOf<String?>()
        val server = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val cursor = request.url.queryParameter("cursor").also { cursors += it }
                    return MockResponse(200, body = when (cursor) {
                        null -> resource("sync/page1.json")
                        "snap1" -> page2
                        else -> """{"changes":[{"entity":"track","op":"delete","id":"$gone","data":null}],"cursor":"delta2","hasMore":false}"""
                    })
                }
            }
            start()
        }
        val h = Harness(server)
        val engine = SyncEngine(h.api, h.db)

        val first = engine.sync()
        assertTrue(first.full)
        assertEquals(3, h.db.library().trackCount().first())
        assertEquals(listOf(null, "snap1"), cursors)
        val second = engine.sync()
        assertEquals(false, second.full)
        assertEquals("delta1", cursors.last())
        assertEquals(2, h.db.library().trackCount().first())
        assertNull(h.db.library().track(gone))
        assertEquals("delta2", h.db.mirror().kv(SyncEngine.CURSOR))
        assertEquals(5, h.db.query("SELECT * FROM artists", null).count)
        assertEquals(0, h.db.query("SELECT * FROM track_artists WHERE trackId = ?", arrayOf(gone)).count)
        h.close()
    }
}
