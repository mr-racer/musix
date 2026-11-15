package ru.musixai.app.feature.player

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Canvas as GCanvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

internal enum class BurstKind { Fire, Water }

private class Particle(
    val t: Int, var x: Float, var y: Float, var vx: Float, var vy: Float,
    val r: Float, val life: Float, var age: Float, val ph: Float,
)

private const val TONGUE = 0
private const val FLAME = 1
private const val EMBER = 2
private const val SMOKE = 3
private const val CROWN = 4
private const val RUN = 5
private const val MIST = 6

/**
 * One shot of particles around the cover (the mock's `burst()`): fire climbs from below — slow tongues for
 * weight, flames along the bottom and both sides, embers, a little smoke; water is thrown off the top edge
 * as a crown of heavy drops, runs down the face in streams, and leaves a cool mist. A particle is a soft
 * round sprite drawn once and scaled, not a gradient built every frame; fire adds its light (Plus).
 * Nothing runs when nothing burns.
 */
@Stable
internal class Bursts {
    internal var kind = BurstKind.Fire
    private var ps: List<Particle> = emptyList()
    /** Bumped every frame while a burst lives: the canvas reads it in the draw phase only. */
    internal var frame by mutableLongStateOf(0L)
    internal var shot by mutableIntStateOf(0)
    internal var reduced = false
    /** The cover's side and the margin round it, px. */
    var span = 1f
    var margin = 1f

    fun play(k: BurstKind) {
        if (reduced) return
        kind = k
        val S = span; val p = margin; val sc = S / 372f
        val rnd = Random(System.nanoTime())
        fun r(lo: Float, hi: Float) = lo + rnd.nextFloat() * (hi - lo)
        val out = ArrayList<Particle>(170)
        if (k == BurstKind.Fire) {
            repeat(30) { out += Particle(TONGUE, r(p + 8, p + S - 8), p + S + r(4f, 26f) * sc, r(-10f, 10f), r(-170f, -90f) * sc, r(30f, 52f) * sc, r(0.9f, 1.5f), -r(0f, 0.5f), r(0f, 6f)) }
            repeat(96) {
                val side = rnd.nextFloat() < 0.34f
                val x = if (side) (if (rnd.nextFloat() < 0.5f) p else p + S) + r(-6f, 6f) else r(p, p + S)
                out += Particle(FLAME, x, if (side) r(p + S * 0.3f, p + S) else p + S + r(-6f, 12f), r(-20f, 20f), r(-300f, -130f) * sc, r(11f, 26f) * sc, r(0.55f, 1.25f), -r(0f, 0.55f), r(0f, 6f))
            }
            repeat(30) { out += Particle(EMBER, r(p, p + S), p + S * r(0.5f, 1f), r(-40f, 40f), r(-380f, -200f) * sc, r(1.6f, 3f), r(1.1f, 1.9f), -r(0.1f, 0.7f), r(0f, 6f)) }
            repeat(8) { out += Particle(SMOKE, r(p + 20, p + S - 20), p + r(-10f, 30f), r(-12f, 12f), r(-60f, -30f), r(34f, 56f) * sc, r(1.2f, 1.8f), -r(0.5f, 0.9f), 0f) }
        } else {
            repeat(34) { out += Particle(CROWN, r(p + 6, p + S - 6), p + r(-4f, 6f), r(-150f, 150f) * sc, r(-330f, -120f) * sc, r(4.5f, 9.5f) * sc, r(0.9f, 1.4f), -r(0f, 0.22f), 0f) }
            repeat(46) { out += Particle(RUN, r(p + 4, p + S - 4), p + r(-2f, 10f), r(-5f, 5f), r(30f, 120f) * sc, r(3.4f, 7f) * sc, r(1f, 1.7f), -r(0f, 0.5f), 0f) }
            repeat(12) { out += Particle(MIST, r(p, p + S), p + r(-16f, 40f), r(-14f, 14f), r(20f, 60f), r(40f, 70f) * sc, r(1f, 1.6f), -r(0f, 0.3f), 0f) }
        }
        ps = out
        shot++
    }

    /** One step of [dt] s; false once every particle has gone. */
    fun step(dt: Float): Boolean {
        var alive = 0
        val sc = span / 372f
        for (p in ps) {
            p.age += dt
            if (p.age < 0) { alive++; continue }
            val q = p.age / p.life
            if (q >= 1f) continue
            alive++
            if (kind == BurstKind.Fire) {
                p.x += (p.vx + sin(p.age * 6 + p.ph) * (if (p.t == EMBER) 46f else 22f)) * dt
                p.y += p.vy * dt; p.vy *= 1f - 0.7f * dt
            } else if (p.t == MIST) {
                p.x += p.vx * dt; p.y += p.vy * dt
            } else {
                p.vy += (if (p.t == CROWN) 1050f else 760f) * sc * dt
                p.x += p.vx * dt; p.y += p.vy * dt
                if (p.t == CROWN) p.vx *= 1f - 1.4f * dt
            }
        }
        if (alive == 0) ps = emptyList()
        return alive > 0
    }

    fun DrawScope.paint(sprites: Sprites) {
        val sc = span / 372f
        for (p in ps) {
            if (p.age < 0) continue
            val q = p.age / p.life
            if (q >= 1f) continue
            if (kind == BurstKind.Fire) {
                if (p.t == SMOKE) { put(sprites.smoke, p.x, p.y, p.r * (1 + q * 0.6f), 0.5f * sin(PI.toFloat() * q), BlendMode.SrcOver); continue }
                val rise = min(1f, q * 6f); val fade = (1 - q) * rise
                if (p.t == EMBER) { put(sprites.hot, p.x, p.y, p.r * (1.6f - q), fade * 1.2f, BlendMode.Plus); continue }
                val r = p.r * (if (p.t == TONGUE) 1 - q * 0.35f else 1 - q * 0.62f)
                val a = if (p.t == TONGUE) 0.34f else 0.62f
                put(sprites.cool, p.x, p.y, r * 1.15f, fade * a * (0.4f + q * 0.6f), BlendMode.Plus)
                put(sprites.hot, p.x, p.y, r * 0.78f, fade * a * (1 - q * 0.9f), BlendMode.Plus)
            } else {
                if (p.y > span + margin * 2 + 20) continue
                if (p.t == MIST) { put(sprites.mist, p.x, p.y, p.r, 0.42f * sin(PI.toFloat() * q), BlendMode.SrcOver); continue }
                val a = (1 - q * q) * 0.95f
                val len = (abs(p.vy) / 26f).coerceIn(0f, 30f) * sc
                if (p.t == RUN && len > 3f) drawLine(Color(0xFF96D4FF), Offset(p.x, p.y - len), Offset(p.x, p.y), strokeWidth = p.r * 0.9f, cap = StrokeCap.Round, alpha = a * 0.5f)
                val stretch = 1f + (abs(p.vy) / 420f).coerceIn(0f, 1.2f)
                scale(1f, stretch, pivot = Offset(p.x, p.y)) { put(sprites.drop, p.x, p.y, p.r, a, BlendMode.SrcOver) }
            }
        }
    }

    private fun DrawScope.put(img: ImageBitmap, x: Float, y: Float, r: Float, alpha: Float, blend: BlendMode) {
        if (alpha <= 0.004f || r <= 0f) return
        drawImage(img, srcOffset = IntOffset.Zero, srcSize = IntSize(64, 64), dstOffset = IntOffset((x - r).toInt(), (y - r).toInt()),
            dstSize = IntSize((r * 2).toInt().coerceAtLeast(1), (r * 2).toInt().coerceAtLeast(1)), alpha = alpha.coerceAtMost(1f), blendMode = blend)
    }
}

/** Soft round sprites, drawn once. */
internal class Sprites {
    val hot = sprite(0f to Color(1f, 0.98f, 0.84f, 1f), 0.3f to Color(1f, 0.81f, 0.36f, 0.9f), 0.62f to Color(1f, 0.5f, 0.125f, 0.42f), 1f to Color(1f, 0.31f, 0.04f, 0f))
    val cool = sprite(0f to Color(1f, 0.59f, 0.21f, 0.95f), 0.45f to Color(0.89f, 0.24f, 0.086f, 0.55f), 1f to Color(0.47f, 0.055f, 0.024f, 0f))
    val smoke = sprite(0f to Color(0.235f, 0.157f, 0.141f, 0.5f), 1f to Color(0.157f, 0.118f, 0.118f, 0f))
    val drop = sprite(0f to Color(0.925f, 0.98f, 1f, 1f), 0.35f to Color(0.59f, 0.84f, 1f, 0.95f), 0.8f to Color(0.27f, 0.63f, 0.965f, 0.6f), 1f to Color(0.196f, 0.51f, 0.925f, 0f))
    val mist = sprite(0f to Color(0.667f, 0.863f, 1f, 0.5f), 1f to Color(0.47f, 0.745f, 1f, 0f))

    private fun sprite(vararg stops: Pair<Float, Color>): ImageBitmap {
        val img = ImageBitmap(64, 64)
        val paint = Paint().apply { shader = (Brush.radialGradient(*stops, center = Offset(32f, 32f), radius = 32f) as androidx.compose.ui.graphics.ShaderBrush).createShader(androidx.compose.ui.geometry.Size(64f, 64f)) }
        GCanvas(img).drawRect(0f, 0f, 64f, 64f, paint)
        return img
    }
}

@Composable
internal fun rememberBursts(): Bursts {
    val b = remember { Bursts() }
    b.reduced = rememberReducedMotion()
    return b
}

/** The canvas over the stage, 64 dp wider on every side; idle (and empty) between bursts. */
@Composable
internal fun BurstLayer(b: Bursts, cover: Dp, modifier: Modifier) {
    val sprites = remember { Sprites() }
    val pad = 64.dp
    LaunchedEffect(b.shot) {
        if (b.shot == 0) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            val now = withFrameNanos { it }
            val dt = ((now - last) / 1e9f).coerceAtMost(0.05f)
            last = now
            val alive = b.step(dt)
            b.frame++
            if (!alive) break
        }
    }
    Canvas(modifier) {
        b.span = cover.toPx(); b.margin = pad.toPx()
        b.frame                       // read in the draw phase: a new frame redraws, nothing recomposes
        with(b) { paint(sprites) }
    }
}
