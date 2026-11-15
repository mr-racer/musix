package ru.musixai.app.feature.player

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme

/**
 * The light of the screen: the song's cover, out of focus, behind everything. While a finger turns
 * the page the next song's light comes up over it as far as the change has gone; when the song has
 * changed it finishes coming up — over the old light, which stays whole beneath until it is covered
 * (two lights fading through each other at once let the black through: the flash of the HTML mock).
 */
@Stable
internal class PlayerLight {
    var base by mutableStateOf<String?>(null)
        private set
    var top by mutableStateOf<String?>(null)
        private set
    /** How far [top] is over [base], 0…1; read in the draw phase only. */
    var amount by mutableFloatStateOf(0f)
        private set
    private var job: Job? = null

    /** The finger: [url]'s light up to [k] of the way. */
    fun peek(url: String?, k: Float) {
        if (url == null) return
        job?.cancel(); job = null
        if (top != url) top = url
        amount = k.coerceIn(0f, 1f)
    }

    /** The song is [url] now (a commit, a tap in the queue, the end of a song). */
    suspend fun arrive(url: String?, instant: Boolean) = coroutineScope {
        if (url == base && top == null) return@coroutineScope
        if (base == null || instant) { base = url; top = null; amount = 0f; return@coroutineScope }
        job?.cancel()
        job = launch {
            if (top != url) { top = url; amount = 0f }
            animate(amount, 1f, animationSpec = tween(((1f - amount) * 900).toInt().coerceAtLeast(120), easing = Ease)) { v, _ -> amount = v }
            base = url; top = null; amount = 0f
        }
    }

    /** The finger let go without a change: the peeked light goes back down. */
    suspend fun settle() = coroutineScope {
        if (top == null) return@coroutineScope
        job?.cancel()
        job = launch {
            animate(amount, 0f, animationSpec = tween(350, easing = Ease)) { v, _ -> amount = v }
            top = null
        }
    }

    private companion object { val Ease = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f) }
}

/** The light, its grain and the shade that keeps the words readable. [fade] — 1 open, 0 folded away. */
@Composable
internal fun PlayerBackdrop(light: PlayerLight, accent2: Color, fade: () -> Float, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val strength = if (dark) 1f else 0.2f
    val grain = remember { grainBitmap() }
    Box(modifier.fillMaxSize().graphicsLayer { alpha = fade() }.background(c.bg)) {
        val base = light.base
        if (base != null) Image(rememberSoftCover(base, DIM_LIGHT), null, Modifier.fillMaxSize().graphicsLayer { scaleX = 1.08f; scaleY = 1.08f; alpha = strength }, contentScale = ContentScale.Crop)
        val top = light.top
        if (top != null) Image(rememberSoftCover(top, DIM_LIGHT), null, Modifier.fillMaxSize().graphicsLayer { scaleX = 1.08f; scaleY = 1.08f; alpha = light.amount * strength }, contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().drawBehind {
            drawRect(ShaderBrush(ImageShader(grain, TileMode.Repeated, TileMode.Repeated)), alpha = if (dark) 0.06f else 0.03f)
            if (dark) {
                drawRect(Brush.radialGradient(listOf(accent2.copy(alpha = 0.3f), Color.Transparent), center = Offset(size.width, 0f), radius = size.width * 0.9f))
                drawRect(Brush.verticalGradient(0f to Color(0x4D08080B), 0.22f to Color(0x1408080B), 0.48f to Color(0x3D08080B), 0.72f to Color(0x9E08080B), 1f to Color(0xD608080B)))
            } else {
                drawRect(Brush.verticalGradient(0f to Color(0x00F2F1F6), 0.6f to Color(0x59F2F1F6), 1f to Color(0xB3F2F1F6)))
            }
        })
    }
}

/** White fractal-ish noise, drawn once (the mock's SVG turbulence). */
private fun grainBitmap(): ImageBitmap {
    val n = 160
    val rnd = java.util.Random(7)
    val px = IntArray(n * n) { val v = rnd.nextInt(256); (v shl 24) or 0xFFFFFF }
    return android.graphics.Bitmap.createBitmap(px, n, n, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
}
