package ru.musixai.app.feature.player

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/**
 * v1 `CoverCombustion`, ported particle for particle: the огонёк/вода burst that wraps the
 * cover in 3D. The previous port was a faint glow behind the art and barely showed (the
 * owner, 2026-10-02).
 * - One simulation, two layers. The BACK layer is drawn before the cover: flame walls, mist,
 *   the aura. The FRONT layer is drawn after it: tongues and rivulets over the rims.
 * - Fire: additive flame particles (a white-yellow core cooling to deep red) rise behind the
 *   cover and climb its side edges, with embers and faint smoke above the crest.
 * - Water: a splash crown off the top edge, then rivulets down the front rims that stretch
 *   with speed and burst into droplets at the bottom, plus a cool mist behind.
 * The sprites are radial gradients rendered once to bitmaps; everything dies within 2.7 s.
 * Coordinates: the cover is (0,0)–(S,S); the layers draw past it, as v1's `.cover-fx`
 * overflows the art on every side.
 */
class CombustionFx(val kind: String, val nonce: Long) {
    internal val parts = ArrayList<P>(420)
    internal var elapsed = 0f
    internal var s = 0f
    private var accB = 0f
    private var accF = 0f
    private var accE = 0f
    private var accS = 0f
    private var started = false
    val fire get() = kind == "fire"
    val done get() = started && (elapsed >= TOTAL || (elapsed >= emit && parts.isEmpty()))
    private val emit get() = if (fire) 1.5f else 1.15f

    internal enum class T { FLAME, EMBER, HAZE, DROP, SPLASH }

    internal class P(
        val type: T, val front: Boolean, var bx: Float, var y: Float, var vx: Float, var vy: Float, var r: Float,
        val life: Float, var age: Float = 0f, val swayF: Float = 0f, val swayA: Float = 0f, val ph: Float = 0f, val grow: Float = 0f,
    )

    private fun rnd(a: Float, b: Float) = a + Random.nextFloat() * (b - a)
    private fun push(p: P) { if (parts.size < 420) parts += p }

    private fun spawnFlame(front: Boolean) {
        val S = s
        var tall = false
        val bx = if (front) {
            val r = Random.nextFloat()  // front tongues hug the side rims; rare short licks at the bottom centre
            when { r < 0.42f -> rnd(-0.02f * S, 0.09f * S); r < 0.84f -> rnd(S - 0.09f * S, S + 0.02f * S); else -> rnd(0.28f * S, S - 0.28f * S) }
        } else {
            val r = Random.nextFloat()  // the bottom wall, plus columns rising just outside the side rims
            tall = Random.nextFloat() < 0.28f
            when { r < 0.55f -> rnd(0.04f * S, S - 0.04f * S); r < 0.78f -> rnd(-0.07f * S, 0.02f * S); else -> rnd(S - 0.02f * S, S + 0.07f * S) }
        }
        val centre = front && bx > 0.2f * S && bx < S - 0.2f * S
        val k = (if (front) 0.72f else 1f) * (if (centre) 0.55f else 1f)
        push(P(T.FLAME, front, bx, rnd(S - 0.02f * S, S + 0.05f * S), 0f, -rnd(0.30f, 0.62f) * S * k * (if (tall) 1.7f else 1f),
            rnd(0.065f, 0.125f) * S * (if (front) 0.75f else 1f) * (if (centre) 0.6f else 1f),
            rnd(0.65f, 1.2f) * (if (tall) 1.35f else 1f) * (if (centre) 0.6f else 1f),
            swayF = rnd(6f, 11f), swayA = rnd(0.03f, 0.09f) * S, ph = rnd(0f, TAU)))
    }

    private fun spawnEmber() = s.let { S ->
        push(P(T.EMBER, Random.nextFloat() < 0.5f, rnd(0.05f * S, S - 0.05f * S), rnd(S - 0.15f * S, S), rnd(-0.06f, 0.06f) * S, -rnd(0.5f, 0.95f) * S,
            rnd(1.6f, 3.2f) * (S / 280f), rnd(1.0f, 1.7f), swayF = rnd(5f, 9f), swayA = rnd(0.02f, 0.05f) * S, ph = rnd(0f, TAU)))
    }

    private fun spawnSmoke() = s.let { S ->
        push(P(T.HAZE, false, rnd(0.1f * S, S - 0.1f * S), rnd(-0.05f * S, 0.35f * S), rnd(-0.03f, 0.03f) * S, -rnd(0.10f, 0.22f) * S,
            rnd(0.06f, 0.11f) * S, rnd(0.9f, 1.5f), swayF = rnd(2f, 4f), swayA = rnd(0.01f, 0.03f) * S, ph = rnd(0f, TAU), grow = 0.10f * S))
    }

    private fun spawnCrown(n: Int) {
        val S = s  // the wave hits the top edge: centre drops crest behind the art, edge ones fall in front
        repeat(n) {
            val bx = rnd(0f, S)
            val edge = bx < 0.22f * S || bx > S - 0.22f * S
            push(P(T.DROP, edge, bx, rnd(-0.05f * S, 0.01f * S), rnd(-0.30f, 0.30f) * S * (if (edge) 1f else 0.55f), -rnd(0.15f, 0.55f) * S,
                rnd(0.014f, 0.038f) * S, 3f))
        }
    }

    private fun spawnRivulet() {
        val S = s  // streams down the FRONT face, clinging to the rims so the art stays readable
        val r = Random.nextFloat()
        val bx = when { r < 0.38f -> rnd(-0.01f * S, 0.06f * S); r < 0.76f -> rnd(S - 0.06f * S, S + 0.01f * S); else -> rnd(0.1f * S, S - 0.1f * S) }
        push(P(T.DROP, true, bx, rnd(-0.06f * S, 0.02f * S), rnd(-0.02f, 0.02f) * S, rnd(0.05f, 0.25f) * S, rnd(0.016f, 0.042f) * S, 3f,
            swayF = rnd(7f, 13f), swayA = rnd(0.006f, 0.018f) * S, ph = rnd(0f, TAU)))
    }

    private fun spawnSplash(x: Float, y: Float) {
        val S = s
        repeat(2 + Random.nextInt(3)) {
            push(P(T.SPLASH, true, x, y, rnd(-0.35f, 0.35f) * S, -rnd(0.05f, 0.30f) * S, rnd(0.007f, 0.016f) * S, rnd(0.25f, 0.45f)))
        }
    }

    private fun spawnMist(n: Int) {
        val S = s
        repeat(n) {
            push(P(T.HAZE, false, rnd(0f, S), rnd(0.15f * S, S), rnd(-0.02f, 0.02f) * S, -rnd(0.02f, 0.06f) * S, rnd(0.14f, 0.28f) * S, rnd(1.4f, 2.0f),
                swayF = rnd(1f, 3f), swayA = rnd(0.01f, 0.02f) * S, ph = rnd(0f, TAU), grow = 0.04f * S))
        }
    }

    /** One frame of v1's `step`. */
    fun step(dtIn: Float, cover: Float) {
        if (cover < 10f) return
        s = cover
        val S = s
        if (!started) { started = true; if (!fire) { spawnCrown(26); spawnMist(8) } }
        val dt = min(0.04f, dtIn)
        elapsed += dt
        if (elapsed < emit) {
            val ease = 1f - elapsed / emit
            if (fire) {
                accB += 95f * ease * dt; while (accB > 1) { spawnFlame(false); accB-- }
                accF += 48f * ease * dt; while (accF > 1) { spawnFlame(true); accF-- }
                accE += 7f * dt; while (accE > 1) { spawnEmber(); accE-- }
                if (elapsed > 0.45f) { accS += 6f * dt; while (accS > 1) { spawnSmoke(); accS-- } }
            } else {
                accF += 55f * ease * dt; while (accF > 1) { spawnRivulet(); accF-- }
            }
        }
        val g = 2.6f * S
        val buoy = 1.05f * S
        var i = parts.size - 1
        while (i >= 0) {
            val p = parts[i]
            p.age += dt
            if (p.age >= p.life) { parts.removeAt(i); i--; continue }
            when (p.type) {
                T.FLAME -> { p.vy = max(p.vy - buoy * dt, -1.5f * S); p.vx = (p.vx + rnd(-1f, 1f) * 0.25f * S * dt) * 0.95f }
                T.EMBER -> p.vy -= 0.5f * S * dt
                T.HAZE -> p.r += p.grow * dt
                T.DROP -> {
                    p.vy = min(p.vy + g * dt, 1.6f * S)
                    if (p.y > S + 0.04f * S) { spawnSplash(p.bx, S + 0.03f * S); parts.removeAt(i); i--; continue }
                }
                T.SPLASH -> p.vy += g * dt
            }
            p.bx += p.vx * dt
            p.y += p.vy * dt
            i--
        }
    }

    internal val env get() = if (elapsed < 1.85f) 1f else max(0f, 1f - (elapsed - 1.85f) / 0.8f)

    companion object {
        const val TOTAL = 2.7f
        private const val TAU = (2 * PI).toFloat()
    }
}

/** The sprites: v1's radial-gradient stops, rendered once to 64 px bitmaps. */
internal class FxSprites(fire: Boolean) {
    val ramp: List<ImageBitmap>
    val ember: ImageBitmap?
    val haze: ImageBitmap

    init {
        ramp = if (fire) listOf(
            sprite(0f to Color(255, 251, 214, 242), 0.30f to Color(255, 206, 84, 153), 1f to Color(255, 140, 0, 0)),
            sprite(0f to Color(255, 168, 60, 217), 0.35f to Color(255, 104, 0, 128), 1f to Color(255, 60, 0, 0)),
            sprite(0f to Color(255, 92, 24, 204), 0.40f to Color(219, 42, 0, 115), 1f to Color(150, 20, 0, 0)),
        ) else listOf(
            sprite(0f to Color(236, 252, 255, 242), 0.30f to Color(158, 224, 255, 153), 1f to Color(80, 170, 255, 0)),
            sprite(0f to Color(148, 214, 255, 217), 0.35f to Color(70, 158, 255, 128), 1f to Color(30, 100, 255, 0)),
            sprite(0f to Color(84, 160, 255, 184), 0.40f to Color(32, 92, 230, 107), 1f to Color(12, 52, 180, 0)),
        )
        ember = if (fire) sprite(0f to Color(255, 244, 200, 255), 0.30f to Color(255, 178, 70, 230), 1f to Color(255, 120, 0, 0)) else null
        haze = if (fire) sprite(0f to Color(46, 40, 38, 82), 1f to Color(46, 40, 38, 0)) else sprite(0f to Color(142, 202, 255, 56), 1f to Color(142, 202, 255, 0))
    }

    private fun sprite(vararg stops: Pair<Float, Color>): ImageBitmap {
        val img = ImageBitmap(64, 64)
        val canvas = androidx.compose.ui.graphics.Canvas(img)
        val paint = androidx.compose.ui.graphics.Paint().apply {
            shader = androidx.compose.ui.graphics.RadialGradientShader(Offset(32f, 32f), 32f, stops.map { it.second }, stops.map { it.first })
        }
        canvas.drawRect(0f, 0f, 64f, 64f, paint)
        return img
    }
}

/** A running burst and its frame counter (read only while drawing: the layers redraw each frame, nothing recomposes). */
class Combustion(val fx: CombustionFx, internal val frame: androidx.compose.runtime.State<Long>)

/** Drives the burst for [burst] (kind, nonce) on the frame clock; null when there is none. */
@Composable
fun rememberCombustion(burst: Pair<String, Long>?): Combustion? {
    val fx = remember(burst) { burst?.let { CombustionFx(it.first, it.second) } } ?: return null
    val frame = remember(fx) { mutableLongStateOf(0L) }
    LaunchedEffect(fx) {
        val until = System.nanoTime() + 3_000_000_000L  // a layer that never draws must not keep the loop alive
        var last = withFrameNanos { it }
        while (!fx.done && System.nanoTime() < until) {
            val now = withFrameNanos { it }
            fx.step((now - last) / 1e9f, fx.s)
            last = now
            frame.longValue++
        }
        frame.longValue++
    }
    return remember(fx) { Combustion(fx, frame) }
}

/**
 * One layer of the burst ([front] = over the rims). Put the back layer before the cover and
 * the front one after it, both the size of the cover; they draw past its edges.
 */
@Composable
fun CombustionLayer(c: Combustion?, front: Boolean, modifier: Modifier = Modifier) {
    if (c == null) return
    val fx = c.fx
    val sprites = remember(fx.kind) { FxSprites(fx.fire) }
    Canvas(modifier) {
        c.frame.value  // read here: each frame redraws the layer
        if (fx.done) return@Canvas
        if (fx.s == 0f) fx.step(0f, size.width)  // the first draw measures the cover
        if (!front) drawAura(fx)
        drawParts(fx, sprites, front)
    }
}

/** `.cover-fx__aura`: the ambient glow — amber from below for fire, blue from above for water. */
private fun DrawScope.drawAura(fx: CombustionFx) {
    val k = fx.elapsed / 2.2f
    if (k >= 1f) return
    val (alpha, scale) = when {
        k < 0.16f -> k / 0.16f to 0.9f + 0.12f * (k / 0.16f)
        k < 0.58f -> 1f - 0.22f * ((k - 0.16f) / 0.42f) to 1.02f - 0.02f * ((k - 0.16f) / 0.42f)
        else -> 0.78f * (1f - (k - 0.58f) / 0.42f) to 1f + 0.05f * ((k - 0.58f) / 0.42f)
    }
    val S = size.width
    val center = Offset(S / 2, if (fx.fire) S * 0.94f else S * 0.0f)
    val radius = S * 0.95f * scale
    val stops = if (fx.fire) arrayOf(0f to Color(255, 146, 32, 140), 0.56f to Color(255, 72, 0, 51), 0.72f to Color.Transparent)
    else arrayOf(0f to Color(60, 168, 255, 107), 0.56f to Color(40, 116, 255, 41), 0.72f to Color.Transparent)
    drawCircle(Brush.radialGradient(*stops, center = center, radius = radius), radius, center, alpha = alpha.coerceIn(0f, 1f))
}

private fun DrawScope.drawParts(fx: CombustionFx, sp: FxSprites, front: Boolean) {
    val S = fx.s
    val env = fx.env
    for (p in fx.parts) {
        if (p.front != front) continue
        val t = p.age / p.life
        var rr = p.r
        var elong = 1f
        var swayK = 1f
        val img: ImageBitmap
        val a: Float
        when (p.type) {
            CombustionFx.T.FLAME -> {
                img = sp.ramp[if (t < 0.32f) 0 else if (t < 0.68f) 1 else 2]
                a = min(1f, t * 5f) * (1f - t).pow(1.15f)
                rr = p.r * (0.6f + 0.4f * (1f - t))  // taper toward the tip
                elong = 1.65f
                swayK = 0.35f + t                    // tips sway more than roots
            }
            CombustionFx.T.EMBER -> { img = sp.ember ?: sp.ramp[0]; a = (0.55f + 0.45f * sin(p.age * 26f + p.ph)) * (1f - t).pow(0.8f) }
            CombustionFx.T.HAZE -> { img = sp.haze; a = min(1f, t * 4f) * (1f - t).pow(1.4f) }
            CombustionFx.T.DROP -> {
                val speed = min(1f, abs(p.vy) / (1.2f * S))  // fast water = white foam
                img = sp.ramp[if (speed > 0.55f) 0 else if (speed > 0.25f) 1 else 2]
                a = 0.9f
                elong = 1f + 1.6f * speed                  // stretch with speed
            }
            CombustionFx.T.SPLASH -> { img = sp.ramp[0]; a = 0.9f * (1f - t) }
        }
        val alpha = (a * env).coerceIn(0f, 1f)
        if (alpha <= 0.01f || rr < 0.5f) continue
        val dx = p.bx + if (p.swayA != 0f) sin(p.age * p.swayF + p.ph) * p.swayA * swayK else 0f
        val w = (rr * 2).roundToInt().coerceAtLeast(1)
        val h = (rr * 2 * elong).roundToInt().coerceAtLeast(1)
        drawImage(img, IntOffset.Zero, IntSize(64, 64), IntOffset((dx - rr).roundToInt(), (p.y - rr * elong).roundToInt()), IntSize(w, h),
            alpha = alpha, blendMode = if (p.type == CombustionFx.T.HAZE) BlendMode.SrcOver else BlendMode.Plus)
    }
}
