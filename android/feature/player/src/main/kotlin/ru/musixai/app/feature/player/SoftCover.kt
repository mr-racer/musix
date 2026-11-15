package ru.musixai.app.feature.player

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.LocalContext
import coil3.SingletonImageLoader
import coil3.compose.rememberAsyncImagePainter
import coil3.request.ImageRequest
import coil3.request.transformations
import coil3.size.Size
import coil3.transform.Transformation

/**
 * The out-of-focus copy of a cover, drawn once into a small picture (the mock's `bake`): a live
 * blur on a moving layer is what costs frames. [dim] darkens it (0.72 the paused cover, 0.42 the
 * back of the cover under the words, 1 the light of the screen).
 */
internal class Soften(private val dim: Float, private val radius: Int = 4) : Transformation() {
    override val cacheKey: String = "soften-$dim-$radius"

    override suspend fun transform(input: Bitmap, size: Size): Bitmap {
        val n = 96
        val out = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        val m = ColorMatrix().apply { setSaturation(1.15f) }
        m.postConcat(ColorMatrix(floatArrayOf(dim, 0f, 0f, 0f, 0f, 0f, dim, 0f, 0f, 0f, 0f, 0f, dim, 0f, 0f, 0f, 0f, 0f, 1f, 0f)))
        val paint = Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(m) }
        // a little past the edges, so the blur does not pull the border in
        Canvas(out).drawBitmap(input, null, android.graphics.RectF(-10f, -10f, n + 10f, n + 10f), paint)
        val px = IntArray(n * n)
        out.getPixels(px, 0, n, 0, 0, n, n)
        repeat(3) { boxBlur(px, n, radius) }
        out.setPixels(px, 0, n, 0, 0, n, n)
        return out
    }

    /** One horizontal and one vertical running-sum pass; three of them come close to a gaussian. */
    private fun boxBlur(px: IntArray, n: Int, r: Int) {
        val tmp = IntArray(px.size)
        for (pass in 0..1) {
            val src = if (pass == 0) px else tmp
            val dst = if (pass == 0) tmp else px
            for (line in 0 until n) {
                var a = 0; var rr = 0; var g = 0; var b = 0
                fun at(i: Int): Int { val k = i.coerceIn(0, n - 1); return if (pass == 0) src[line * n + k] else src[k * n + line] }
                for (i in -r..r) { val c = at(i); a += c ushr 24; rr += c shr 16 and 255; g += c shr 8 and 255; b += c and 255 }
                val w = 2 * r + 1
                for (i in 0 until n) {
                    val idx = if (pass == 0) line * n + i else i * n + line
                    dst[idx] = (a / w shl 24) or (rr / w shl 16) or (g / w shl 8) or (b / w)
                    val add = at(i + r + 1); val sub = at(i - r)
                    a += (add ushr 24) - (sub ushr 24); rr += (add shr 16 and 255) - (sub shr 16 and 255)
                    g += (add shr 8 and 255) - (sub shr 8 and 255); b += (add and 255) - (sub and 255)
                }
            }
        }
    }
}

internal const val DIM_PAUSED = 0.72f
internal const val DIM_WORDS = 0.42f
internal const val DIM_LIGHT = 1f

private fun softRequest(ctx: android.content.Context, url: String?, dim: Float) =
    ImageRequest.Builder(ctx).data(url).size(96).transformations(Soften(dim, if (dim == DIM_LIGHT) 6 else 4)).build()

@Composable
internal fun rememberSoftCover(url: String?, dim: Float): Painter {
    val ctx = LocalContext.current
    val req = remember(url, dim) { softRequest(ctx, url, dim) }
    return rememberAsyncImagePainter(req)
}

/** The neighbours' soft covers are made before the first swipe: one made under the finger is a missed frame. */
@Composable
internal fun WarmSoftCovers(urls: List<String?>) {
    val ctx = LocalContext.current
    LaunchedEffect(urls) {
        val loader = SingletonImageLoader.get(ctx)
        for (u in urls.filterNotNull().distinct()) for (d in floatArrayOf(DIM_LIGHT, DIM_PAUSED)) loader.enqueue(softRequest(ctx, u, d))
    }
}
