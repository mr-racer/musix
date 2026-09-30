package ru.musixai.app.core.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Loudness normalization (spec §3): the manifest's gain brings a track to −14 LUFS, and
 * the server already caps a boost at the −1 dBTP true-peak headroom. Attenuation goes
 * through the player volume; a boost cannot (volume tops out at 1.0), so it goes through
 * [GainProcessor] — PCM gain before the sink.
 */
object Normalization {
    data class Plan(val volume: Float, val boostDb: Float)

    fun plan(gainDb: Double?, enabled: Boolean): Plan {
        if (!enabled || gainDb == null || gainDb.isNaN()) return Plan(1f, 0f)
        return if (gainDb <= 0) Plan(10.0.pow(gainDb / 20).toFloat(), 0f) else Plan(1f, gainDb.coerceAtMost(MAX_BOOST_DB).toFloat())
    }

    fun linear(db: Float): Float = 10.0.pow(db / 20.0).toFloat()

    /** A last guard; the server's headroom rule is the real limit. */
    const val MAX_BOOST_DB = 12.0
}

/** A gain on 16-bit PCM, clamped per sample so a wrong peak estimate clips softly, not wraps. */
@UnstableApi
class GainProcessor : BaseAudioProcessor() {
    @Volatile var gainDb: Float = 0f

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat =
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) inputAudioFormat else AudioProcessor.AudioFormat.NOT_SET

    override fun queueInput(inputBuffer: ByteBuffer) {
        val n = inputBuffer.remaining()
        if (n == 0) return
        val out = replaceOutputBuffer(n)
        val g = Normalization.linear(gainDb)
        if (g == 1f) {
            out.put(inputBuffer)
        } else {
            val src = inputBuffer.order(ByteOrder.LITTLE_ENDIAN)
            while (src.remaining() >= 2) {
                out.putShort((src.short * g).roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
            }
        }
        out.flip()
    }
}
