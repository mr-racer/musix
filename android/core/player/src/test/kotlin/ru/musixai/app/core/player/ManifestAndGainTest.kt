package ru.musixai.app.core.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

@UnstableApi
class ManifestAndGainTest {
    @Test
    fun `urls are re-signed after expiry or a 403, fall back on a 404, and are kept per network`() {
        var net = Network.WIFI
        var clock = 1_000L
        val calls = mutableListOf<Pair<List<String>, Network>>()
        var signature = 0
        val r = ManifestResolver(
            fetch = { ids, n ->
                calls += ids to n
                signature++
                ids.map { ManifestEntry(it, listOf("lossless" to "https://m/$it/lossless?s=$signature", "high" to "https://m/$it/high?s=$signature"), -3.0, clock + 3600) }
            },
            network = { net },
            lookahead = { id -> if (id == "a") listOf("b", "c") else emptyList() },
            now = { clock },
        )
        assertEquals(Resolved("https://m/a/lossless?s=1", "lossless", "a:lossless"), r.resolve("a"))
        assertEquals(listOf("a", "b", "c"), calls.single().first)  // the next tracks come along
        r.resolve("b")
        assertEquals(1, calls.size)  // b was prefetched with a

        r.invalidate("a")  // a 403 on its URL
        assertEquals("https://m/a/lossless?s=2", r.resolve("a").url)
        assertTrue(r.fallBack("a"))  // a 404 on the lossless source
        assertEquals(Resolved("https://m/a/high?s=2", "high", "a:high"), r.resolve("a"))
        assertFalse(r.fallBack("a"))  // nothing after high

        net = Network.CELLULAR  // a network change: a fresh manifest for that network
        r.resolve("c")
        assertEquals(Network.CELLULAR, calls.last().second)
        clock += 3600  // past the expiry margin
        net = Network.WIFI
        r.resolve("b")
        assertEquals(listOf("b"), calls.last().first)
    }

    @Test
    fun `normalization attenuates by volume and boosts through PCM gain, clamped`() {
        assertEquals(Normalization.Plan(1f, 0f), Normalization.plan(null, true))
        assertEquals(Normalization.Plan(1f, 0f), Normalization.plan(-6.0, false))
        val cut = Normalization.plan(-6.0, true)
        assertEquals(0.501f, cut.volume, 0.001f)
        assertEquals(0f, cut.boostDb)
        assertEquals(Normalization.Plan(1f, 3f), Normalization.plan(3.0, true))

        val p = GainProcessor().apply { gainDb = 6.0206f }  // ×2
        p.configure(AudioProcessor.AudioFormat(44_100, 1, C.ENCODING_PCM_16BIT))
        p.flush()
        val input = ByteBuffer.allocateDirect(6).order(ByteOrder.LITTLE_ENDIAN).apply { putShort(1000); putShort(-1000); putShort(20_000); flip() }
        p.queueInput(input)
        val out = p.output.order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(listOf<Short>(2000, -2000, Short.MAX_VALUE), List(3) { out.short })  // 40 000 clips, never wraps
    }
}
