package ru.musixai.app.feature.home

import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.dp
import ru.musixai.app.core.designsystem.MusixTheme
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.pow

/** One lens wave per start of «Поток»: [fire] from the orb's centre (root px). */
@Stable
internal class SkyWave {
    var origin by mutableStateOf(Offset.Zero)
        private set
    var runs by mutableIntStateOf(0)
        private set
    internal val t = Animatable(1f)

    fun fire(at: Offset) {
        origin = at
        runs++
    }
}

/**
 * The home's sky: the dusk gradient and the taste aurora, drawn once — no drift, nothing
 * runs at rest. A start of «Поток» sends one ring across it that bends what is under it
 * (r3 §5.2 «волна-линза»): an AGSL RuntimeShader on API 33+, for 900 ms, fading; below 33
 * a faint ring of light with no bending. Reduced motion: no wave at all.
 */
@Composable
internal fun Sky(blobs: List<Color>, wave: SkyWave, reduced: Boolean, modifier: Modifier = Modifier) {
    val dark = MusixTheme.isDark
    LaunchedEffect(wave.runs) {
        if (wave.runs == 0 || reduced) return@LaunchedEffect
        wave.t.snapTo(0f)
        wave.t.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
    }
    var at by remember { mutableStateOf(Offset.Zero) }
    val lens = remember { if (Build.VERSION.SDK_INT >= 33) Lens() else null }
    val c = blobs.map { animateColorAsState(it, tween(1600), label = "sky").value }
    Box(modifier.fillMaxSize().onGloballyPositioned { at = it.boundsInRoot().topLeft }) {
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer {
                    val t = wave.t.value
                    renderEffect = if (lens != null && t < 1f && Build.VERSION.SDK_INT >= 33) {
                        val o = wave.origin - at
                        val far = max(max(hypot(o.x, o.y), hypot(size.width - o.x, o.y)), max(hypot(o.x, size.height - o.y), hypot(size.width - o.x, size.height - o.y)))
                        val start = 48.dp.toPx()
                        lens.effect(o, start + (far - start) * t, 36.dp.toPx(), 18.dp.toPx() * (1f - t).pow(1.2f),
                            rim = if (dark) Color.White else Color(0xFF7C5BFF), amount = (if (dark) 0.10f else 0.12f) * (1f - t))
                    } else null
                }
                .background(
                    if (dark) Brush.radialGradient(0f to Color(0xFF15151B), 0.6f to Color(0xFF0A0A0E), 1f to Color(0xFF07070A), center = Offset(540f, 0f), radius = 2400f)
                    else Brush.radialGradient(0f to Color(0xFFFAFAFF), 0.6f to Color(0xFFECECF3), 1f to Color(0xFFE3E2E8), center = Offset(540f, 0f), radius = 2400f),
                ),
        ) {
            Canvas(Modifier.fillMaxWidth().height(560.dp).graphicsLayer { alpha = if (dark) 0.34f else 0.24f }) {
                val w = size.width
                val h = size.height
                fun blob(color: Color, cx: Float, cy: Float, r: Float) =
                    drawCircle(Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center = Offset(cx, cy), radius = r), r, Offset(cx, cy))
                blob(c[0], w * 0.2f, h * 0.25f, w * 0.75f)
                blob(c[1], w * 0.8f, h * 0.2f, w * 0.7f)
                blob(c[2], w * 0.5f, h * 0.59f, w * 0.65f)
                blob(c[3], w * 0.4f, h * 0.7f, w * 0.5f)
                drawRect(Brush.verticalGradient(0f to Color.Black, 0.4f to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
            }
        }
        if (lens == null && !reduced) Canvas(Modifier.fillMaxSize()) {
            val t = wave.t.value
            if (t >= 1f) return@Canvas
            val o = wave.origin - at
            val far = hypot(size.width, size.height)
            val start = 48.dp.toPx()
            drawCircle((if (dark) Color.White else Color(0xFF7C5BFF)).copy(alpha = 0.22f * (1f - t)), start + (far - start) * t, o, style = Stroke(2.dp.toPx()))
        }
    }
}

@RequiresApi(33)
private class Lens {
    private val shader = RuntimeShader(
        """
        uniform shader content;
        uniform float2 center;
        uniform float radius;
        uniform float width;
        uniform float strength;
        uniform float4 rim;
        uniform float amount;
        half4 main(float2 p) {
            float2 d = p - center;
            float dist = length(d);
            float x = (dist - radius) / width;
            float w = exp(-x * x);
            float2 dir = dist > 0.001 ? d / dist : float2(0.0, 0.0);
            // the ring's slope pushes pixels out on its outer side and in on its inner side;
            // its crest catches a little light, or the bend is lost on a smooth sky
            half4 c = content.eval(p - dir * (strength * w * x));
            return half4(mix(c.rgb, half3(rim.rgb) * c.a, w * amount), c.a);
        }
        """.trimIndent(),
    )

    fun effect(center: Offset, radius: Float, width: Float, strength: Float, rim: Color, amount: Float): androidx.compose.ui.graphics.RenderEffect {
        shader.setFloatUniform("center", center.x, center.y)
        shader.setFloatUniform("rim", rim.red, rim.green, rim.blue, 1f)
        shader.setFloatUniform("amount", amount)
        shader.setFloatUniform("radius", radius)
        shader.setFloatUniform("width", width)
        shader.setFloatUniform("strength", strength)
        return RenderEffect.createRuntimeShaderEffect(shader, "content").asComposeRenderEffect()
    }
}
