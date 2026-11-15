package ru.musixai.app.feature.catalog

import android.graphics.Bitmap
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.ProgressiveImage
import ru.musixai.app.core.designsystem.control.LitMoment
import ru.musixai.app.core.designsystem.control.Pill
import ru.musixai.app.core.designsystem.control.SongLine
import ru.musixai.app.core.designsystem.control.rememberPlayClock
import ru.musixai.app.core.designsystem.motion.drawWave
import ru.musixai.app.core.designsystem.motion.rememberWave
import ru.musixai.app.core.designsystem.text
import ru.musixai.app.core.model.SoundMoment
import ru.musixai.app.core.model.SoundSection

/** «Волна»: tap to play / stop — it rises on a spring, ripples, lies flat; at rest no frames. */
@Composable
internal fun WaveDemo() {
    var on by remember { mutableStateOf(true) }
    val wave = rememberWave(on)
    val accent = MusixTheme.colors.accent
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Canvas(Modifier.fillMaxWidth().height(28.dp)) { drawWave(wave, size.width * 0.7f, size.height / 2, accent) }
        Pill(if (on) "Пауза" else "Играть", onClick = { on = !on })
    }
}

private val DEMO_SECTIONS = listOf(
    SoundSection(0.0, 14.0, "intro", "вступление"), SoundSection(14.0, 46.0, "verse", "куплет 1"),
    SoundSection(46.0, 70.0, "chorus", "припев"), SoundSection(70.0, 100.0, "verse", "куплет 2"),
    SoundSection(100.0, 126.0, "chorus", "припев"), SoundSection(126.0, 150.0, "outro", "финал"),
)
private val DEMO_MOMENTS = listOf(SoundMoment(46.0, "drop", "вступают барабаны", "chorus"), SoundMoment(112.0, "solo", "соло гитары", "chorus"))

/** «Полоса песни» on a made-up song: plays by itself, scrub it with a finger. */
@Composable
internal fun SongLineDemo() {
    var playing by remember { mutableStateOf(true) }
    var pos by remember { mutableIntStateOf(30_000) }
    var held by remember { mutableStateOf(false) }
    val clock = rememberPlayClock(pos.toLong(), playing, held)
    val lit = remember { LitMoment() }
    // Room on top: a moment's name rises above the line, as it does in the player.
    Column(Modifier.padding(top = 36.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SongLine(clock, 150.0, DEMO_SECTIONS, DEMO_MOMENTS, playing, MusixTheme.colors.accent, lit,
            onScrub = { held = it }, onSeek = { pos = (it * 1000).toInt() }, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(if (playing) "Пауза" else "Играть", onClick = { pos = (clock.sec * 1000).toInt(); playing = !playing })
            Pill("Назвать соло", onClick = { lit.at = 112.0 })
        }
    }
}

/** A picture drawn in code (no network in the catalog): a gradient with fine stripes that blur away when small. */
private fun picture(px: Int): Bitmap {
    val b = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
    val c = android.graphics.Canvas(b)
    c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, px.toFloat(), px.toFloat(), 0xFF5874EA.toInt(), 0xFFFF78C8.toInt(), Shader.TileMode.CLAMP) })
    val line = Paint().apply { color = 0x66FFFFFF; strokeWidth = px / 128f }
    var x = 0f
    while (x < px * 2) { c.drawLine(x, 0f, x - px, px.toFloat(), line); x += px / 24f }
    return b
}

/** «Сначала лёгкая, потом чёткая»: the 16 px picture at once, the 512 px one 0.9 s later (as from a slow network). */
@Composable
internal fun ProgressiveDemo() {
    val light = remember { Bitmap.createScaledBitmap(picture(512), 16, 16, true) }
    val sharpPic = remember { picture(512) }
    var round by remember { mutableIntStateOf(0) }
    var sharp by remember { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(round) { sharp = null; delay(900); sharp = sharpPic }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        ProgressiveImage(light, sharp, Modifier.size(120.dp).clip(RoundedCornerShape(14.dp)))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (sharp == null) "лёгкая, 16 px" else "чёткая, 512 px", style = MusixTheme.text.caption.copy(color = MusixTheme.colors.textMuted))
            Pill("Ещё раз", onClick = { round++ })
        }
    }
}
