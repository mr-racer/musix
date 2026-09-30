package ru.musixai.app.feature.stats

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.musix.api.models.Collection
import app.musix.api.models.EngagedTrack
import app.musix.api.models.StatsOut
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Arrive
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.skeInset
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.Image

/** v1 `hueFromString`: a stable hue per name (a genre keeps its colour everywhere). */
private fun hueFromString(s: String): Float {
    var h = 0L
    for (ch in s) h = (h * 31 + ch.code) and 0xFFFFFFFFL
    return (h % 360).toFloat()
}

@Composable
private fun Label(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(), modifier, style = MusixTheme.type.mono.copy(fontSize = 11.sp, letterSpacing = 0.2.em, color = MusixTheme.colors.textSubtle))

/** A one-shot 0 → 1 after [delayMs], v1's CSS entrance for a meter or a column. */
@Composable
private fun grow(delayMs: Int, durationMs: Int): Float {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(delayMs.toLong()); t.animateTo(1f, tween(durationMs, easing = Arrive)) }
    return t.value
}

/**
 * v1 `EngagementSection` («что ты дослушиваешь»): the completion arc gauge with the sentence,
 * then the two honest columns — what you truly love (a completion ring per track) and what
 * you drop fastest (the seconds you give it).
 */
@Composable
internal fun EngagementPanel(s: StatsOut, img: (String?) -> Image?) {
    val c = MusixTheme.colors
    val e = s.engagement
    val pct = e.overallCompletion.toFloat().coerceIn(0f, 1f)
    StatCard {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            ArcGauge(pct, 145f, "дослушано")
            Text("Ты дослушиваешь ${(pct * 100).toInt()}% треков до конца", Modifier.padding(top = 12.dp), textAlign = TextAlign.Center,
                style = MusixTheme.type.body.copy(fontSize = 19.sp, fontWeight = FontWeight.Bold, lineHeight = 1.25.em, color = c.text))
            Text("Правда, которую обычное число прослушиваний прячет.", Modifier.padding(top = 8.dp), textAlign = TextAlign.Center,
                style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
        }
        Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            EngagementColumn("Любишь по-настоящему", e.loved, loved = true, img)
            EngagementColumn("Чаще всего бросаешь", e.guilty, loved = false, img)
        }
    }
}

@Composable
private fun EngagementColumn(title: String, tracks: List<EngagedTrack>, loved: Boolean, img: (String?) -> Image?) {
    val c = MusixTheme.colors
    val hue = if (loved) 145f else 30f
    Column {
        Label(title, Modifier.padding(bottom = 12.dp))
        if (tracks.isEmpty()) Text("Статистика ещё не набралась", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic))
        for (t in tracks.take(5)) Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Cover(img(t.track.coverImageId), t.track.title, t.track.artistDisplay, size = 44.dp, radius = 9.dp)
            Column(Modifier.weight(1f)) {
                Text(t.track.titleDisplay ?: t.track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 14.5.sp, color = c.text))
                Text(if (loved) "${t.track.artistDisplay} · дослушано ${t.finishes} ${plural(t.finishes, "раз", "раза", "раз")}" else t.track.artistDisplay,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
            }
            if (loved) CompletionRing(t.completion.toFloat(), hue)
            else Column(horizontalAlignment = Alignment.End, modifier = Modifier.widthIn(min = 58.dp)) {
                val sec = t.skipSeconds?.let { (Math.round(it.toDouble() * 10) / 10.0).toString().removeSuffix(".0") } ?: "—"
                Text("≈${sec}с", style = MusixTheme.type.body.copy(fontSize = 16.sp, fontWeight = FontWeight.Bold, lineHeight = 1.05.em, color = oklch(74f, 0.15f, hue)))
                Text("${t.skips}× скип", Modifier.padding(top = 3.dp), style = MusixTheme.type.mono.copy(fontSize = 10.5.sp, color = c.textSubtle))
            }
        }
    }
}

/** v1 `SkeuoArcGauge`: a half dial, the arc and its bead swinging in over 900 ms. */
@Composable
private fun ArcGauge(value: Float, hue: Float, label: String) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val k = grow(0, 900) * value
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Canvas(Modifier.width(168.dp).height(103.dp)) {
            val u = size.width / 128f
            val r = 54f * u
            val ctr = Offset(64f * u, 64f * u)
            val tl = Offset(ctr.x - r, ctr.y - r)
            val sz = androidx.compose.ui.geometry.Size(2 * r, 2 * r)
            drawArc(if (dark) Color(0x80000000) else Color(0x29281E3C), 180f, 180f, false, tl, sz, style = Stroke(9f * u, cap = StrokeCap.Round))
            drawArc(oklch(70f, 0.17f, hue, 0.35f), 180f, 180f * k, false, tl, sz, style = Stroke(15f * u, cap = StrokeCap.Round))  // the glow
            drawArc(oklch(70f, 0.17f, hue), 180f, 180f * k, false, tl, sz, style = Stroke(9f * u, cap = StrokeCap.Round))
            val a = Math.PI - k * Math.PI
            val bead = Offset(ctr.x + r * kotlin.math.cos(a).toFloat(), ctr.y - r * kotlin.math.sin(a).toFloat())
            drawCircle(oklch(75f, 0.18f, hue, 0.5f), 8f * u, bead)
            drawCircle(Color.White, 4.5f * u, bead)
        }
        Text("${(value * 100).toInt()}%", Modifier.padding(top = 0.dp), style = MusixTheme.type.body.copy(fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, color = c.text))
        Text(label.uppercase(), style = MusixTheme.type.mono.copy(fontSize = 11.sp, letterSpacing = 0.2.em, color = c.textSubtle))
    }
}

/** v1 `CompletionRing`: a small embossed dial with the percent inside. */
@Composable
private fun CompletionRing(p: Float, hue: Float) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(42.dp)) {
            val w = 3.5.dp.toPx()
            drawCircle(if (dark) Color(0x1AFFFFFF) else Color(0x1A000000), size.width / 2 - w, style = Stroke(w))
            drawArc(oklch(70f, 0.16f, hue), -90f, 360f * p.coerceIn(0f, 1f), false, Offset(w, w), androidx.compose.ui.geometry.Size(size.width - 2 * w, size.height - 2 * w), style = Stroke(w, cap = StrokeCap.Round))
        }
        Text("${(p * 100).toInt()}", style = MusixTheme.type.body.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.text))
    }
}

/** v1 `DistributionsPanel` («карта коллекции»): decades, genres, artists, lengths, formats. */
@Composable
internal fun CollectionPanel(col: Collection, img: (String?) -> Image?) {
    StatCard {
        Column(verticalArrangement = Arrangement.spacedBy(30.dp)) {
            EraBars(col)
            Meters("По жанрам", col.genres.map { Triple(it.key, "${it.count} · ${it.pct}%", it.count) }, height = 12.dp) { name -> hueFromString(name) to 22f }
            ArtistMosaic(col, img)
            Meters("Длина трека", col.durations.map { Triple(minutes(it.key), "${it.count}", it.count) }, height = 11.dp, labelMuted = true) { 150f to 15f }
            Column {
                Label("Качество", Modifier.padding(bottom = 10.dp))
                Text(buildAnnotatedString {
                    withStyle(SpanStyle(color = oklch(68f, 0.16f, 150f), fontWeight = FontWeight.Bold)) { append("${col.losslessPct}%") }
                    append(" без потерь")
                }, Modifier.padding(bottom = 13.dp), style = MusixTheme.type.body.copy(fontSize = 14.sp, color = MusixTheme.colors.text))
                Meters(null, col.formats.map { Triple(it.key + if (it.key in LOSSLESS) " ✓" else "", "${it.pct}%", it.count) }, height = 11.dp, labelMuted = true) { key ->
                    if (key.removeSuffix(" ✓") in LOSSLESS) 150f to 12f else 50f to 12f
                }
            }
        }
    }
}

private val LOSSLESS = setOf("FLAC", "WAV", "AIFF", "ALAC", "APE")

/** v1 `fmtRange`: "180-240" seconds → «3–4 мин». */
private fun minutes(range: String): String =
    Regex("""(\d+)\s*-\s*(\d+)""").find(range)?.destructured?.let { (a, b) -> "${Math.round(a.toInt() / 60.0)}–${Math.round(b.toInt() / 60.0)} мин" } ?: range

/** v1 `EraBars`: a column per decade growing up over 700 ms (50 ms apart), the peak in amber. */
@Composable
private fun EraBars(col: Collection) {
    val c = MusixTheme.colors
    val d = col.decades
    Column {
        val peak = d.maxByOrNull { it.count }
        Row(Modifier.fillMaxWidth().padding(bottom = 14.dp), verticalAlignment = Alignment.Bottom) {
            Label("По эпохам", Modifier.weight(1f))
            peak?.let { p ->
                Text(buildAnnotatedString {
                    append("Ядро коллекции — ")
                    withStyle(SpanStyle(color = c.amber, fontWeight = FontWeight.Bold)) { append("${p.decade}s · ${p.pct}%") }
                }, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            }
        }
        if (d.isEmpty()) { Text("—", style = MusixTheme.type.body.copy(color = c.textMuted)); return@Column }
        val max = d.maxOf { it.count }.coerceAtLeast(1)
        Row(Modifier.fillMaxWidth().height(140.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            d.forEachIndexed { i, x ->
                val pk = x == peak
                val k = grow(i * 50, 700)
                Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                    Text("${x.count}", Modifier.padding(bottom = 6.dp), maxLines = 1,
                        style = MusixTheme.type.mono.copy(fontSize = 10.5.sp, fontWeight = if (pk) FontWeight.Bold else FontWeight.Normal, color = if (pk) c.amber else c.textMuted))
                    val h = (4f + (x.count.toFloat() / max) * (140f - 28f)) * k
                    Box(Modifier.widthIn(max = 56.dp).fillMaxWidth().height(h.dp)
                        .dropShadow(RoundedCornerShape(topStart = 7.dp, topEnd = 7.dp, bottomStart = 3.dp, bottomEnd = 3.dp),
                            Shadow(radius = 10.dp, color = (if (pk) c.amber else oklch(70f, 0.16f, 268f)).copy(alpha = 0.35f)))
                        .clip(RoundedCornerShape(topStart = 7.dp, topEnd = 7.dp, bottomStart = 3.dp, bottomEnd = 3.dp))
                        .background(Brush.verticalGradient(if (pk) listOf(oklch(80f, 0.15f, 80f), oklch(62f, 0.16f, 58f)) else listOf(oklch(72f, 0.17f, 268f), oklch(54f, 0.17f, 268f)))))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (x in d) Text("${x.decade.toString().takeLast(2)}s", Modifier.weight(1f), textAlign = TextAlign.Center, maxLines = 1,
                style = MusixTheme.type.mono.copy(fontSize = 10.5.sp, fontWeight = if (x == peak) FontWeight.Bold else FontWeight.Normal, color = if (x == peak) c.amber else c.textSubtle))
        }
    }
}

/** v1's carved grooves with a glass fill that grows in (meterTick, 550 ms, 60 ms apart). */
@Composable
private fun Meters(title: String?, rows: List<Triple<String, String, Int>>, height: androidx.compose.ui.unit.Dp, labelMuted: Boolean = false, hue: (String) -> Pair<Float, Float>) {
    val c = MusixTheme.colors
    Column {
        title?.let { Label(it, Modifier.padding(bottom = 12.dp)) }
        if (rows.isEmpty()) Text("—", style = MusixTheme.type.body.copy(color = c.textMuted))
        val max = rows.maxOfOrNull { it.third }?.coerceAtLeast(1) ?: 1
        rows.forEachIndexed { i, (name, value, n) ->
            val (h, shift) = hue(name)
            val k = grow(i * 60, 550)
            Column(Modifier.padding(bottom = 12.dp)) {
                Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                    Text(name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MusixTheme.type.body.copy(fontSize = 13.5.sp, color = if (labelMuted) c.textMuted else c.text))
                    Spacer(Modifier.width(8.dp))
                    Text(value, style = MusixTheme.type.mono.copy(fontSize = 11.5.sp, color = if (labelMuted) c.textSubtle else c.textMuted))
                }
                Box(Modifier.fillMaxWidth().height(height).skeInset(RoundedCornerShape(7.dp)).clip(RoundedCornerShape(7.dp))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth((n.toFloat() / max * k).coerceAtLeast(0.001f)).clip(RoundedCornerShape(7.dp))
                        .background(Brush.horizontalGradient(listOf(oklch(58f, 0.18f, h), oklch(70f, 0.17f, h + shift)))))
                }
            }
        }
    }
}

/** v1 `ArtistMosaic`: the five artists the library holds most of, ranked. */
@Composable
private fun ArtistMosaic(col: Collection, img: (String?) -> Image?) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    Column {
        Label("По артистам", Modifier.padding(bottom = 12.dp))
        if (col.artists.isEmpty()) Text("—", style = MusixTheme.type.body.copy(color = c.textMuted))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            col.artists.forEachIndexed { i, a ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(if (dark) Color(0x0AFFFFFF) else Color(0xB3FFFFFF))
                    .border(1.dp, c.border, RoundedCornerShape(13.dp)).padding(horizontal = 11.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Cover(img(a.artist.imageId), a.artist.name, a.artist.name, size = 42.dp, radius = 11.dp)
                    Column(Modifier.weight(1f)) {
                        Text(a.artist.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.text))
                        Text("${a.count} ${plural(a.count, "трек", "трека", "треков")}", style = MusixTheme.type.mono.copy(fontSize = 11.5.sp, color = c.textSubtle))
                    }
                    Text("#${i + 1}", style = MusixTheme.type.mono.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.textMuted))
                }
            }
        }
    }
}
