package ru.musixai.app.core.designsystem.component

import android.graphics.Bitmap
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.withSign

/** The reference BlurHash decoder (woltapp/blurhash), for cover placeholders from /sync. */
object BlurHash {
    private const val CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"

    private fun decode83(s: String, from: Int, to: Int): Int {
        var v = 0
        for (i in from until to) v = v * 83 + CHARS.indexOf(s[i]).also { require(it >= 0) }
        return v
    }

    private fun srgbToLinear(v: Int): Double { val x = v / 255.0; return if (x <= 0.04045) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4) }
    private fun linearToSrgb(v: Double): Int { val x = v.coerceIn(0.0, 1.0); return ((if (x <= 0.0031308) x * 12.92 else 1.055 * x.pow(1 / 2.4) - 0.055) * 255 + 0.5).toInt() }
    private fun signPow(v: Double, e: Double) = kotlin.math.abs(v).pow(e).withSign(v)

    fun decode(hash: String, width: Int, height: Int, punch: Double = 1.0): Bitmap? = runCatching {
        require(hash.length >= 6)
        val size = decode83(hash, 0, 1)
        val nx = size % 9 + 1
        val ny = size / 9 + 1
        require(hash.length == 4 + 2 * nx * ny)
        val maxAc = (decode83(hash, 1, 2) + 1) / 166.0
        val colors = Array(nx * ny) { i ->
            if (i == 0) {
                val v = decode83(hash, 2, 6)
                doubleArrayOf(srgbToLinear(v shr 16), srgbToLinear((v shr 8) and 255), srgbToLinear(v and 255))
            } else {
                val v = decode83(hash, 4 + i * 2, 6 + i * 2)
                intArrayOf(v / (19 * 19), (v / 19) % 19, v % 19).map { signPow((it - 9) / 9.0, 2.0) * maxAc * punch }.toDoubleArray()
            }
        }
        val px = IntArray(width * height)
        for (y in 0 until height) for (x in 0 until width) {
            var r = 0.0; var g = 0.0; var b = 0.0
            for (j in 0 until ny) for (i in 0 until nx) {
                val basis = cos(PI * x * i / width) * cos(PI * y * j / height)
                val c = colors[i + j * nx]
                r += c[0] * basis; g += c[1] * basis; b += c[2] * basis
            }
            px[x + y * width] = (0xFF shl 24) or (linearToSrgb(r) shl 16) or (linearToSrgb(g) shl 8) or linearToSrgb(b)
        }
        Bitmap.createBitmap(px, width, height, Bitmap.Config.ARGB_8888)
    }.getOrNull()
}
