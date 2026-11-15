package ru.musixai.app.feature.artist

import androidx.compose.ui.geometry.CornerRadius
import ru.musixai.app.core.designsystem.text
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.motion.FlightKey
import ru.musixai.app.core.designsystem.motion.FlightKind
import ru.musixai.app.core.designsystem.motion.flightSpot
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.motion.springOf
import kotlin.math.ceil
import kotlin.math.roundToInt

/** The axis's sizes for a page [w] wide: the cover [s], a cover and its caption [block], the zipper's [step]. */
internal class AxisGeom(w: Dp) {
    private val ap = if (w < 380.dp) 12.dp else 16.dp
    val s: Dp = ((w - ap * 2 - 40.dp) / 2).value.toInt().dp
    val cap = 60.dp
    val block: Dp = s + 9.dp + cap
    val step: Dp = maxOf((s.value * 0.62f).roundToInt(), ceil((block.value + 22f) / 2f).toInt()).dp
    val xl: Dp = w / 2 - 20.dp - s
    val xr: Dp = w / 2 + 20.dp
}

private class Mark(val y: Dp, val text: String, val gap: Boolean)
private class Seg(val y0: Dp, val y1: Dp, val gap: Boolean)

/**
 * «Ось лет» (the discography): the albums on a line of years, left and right in turn like a zipper;
 * a year pill on the line by each, a mark where more than six years passed, where the band formed and
 * where it ended. A cover is grey until heard — the colour rises in it like water to the share of its
 * songs heard (once, as it first comes into view), a full one gets the level's check. Pressed, a
 * vinyl slides out from under it. The cover and the title open the album (each its own flight).
 */
@Composable
internal fun DiscoAxis(ui: ArtistUi, w: Dp, onOpen: (Disc) -> Unit) {
    val c = MusixTheme.colors
    val al = ui.albums
    if (al.isEmpty()) return
    if (al.size == 1) { SoloAlbum(ui, al[0], w, onOpen); return }
    val g = remember(w) { AxisGeom(w) }
    val tops = ArrayList<Dp>(al.size)
    val marks = ArrayList<Mark>()
    val segs = ArrayList<Seg>()
    var y = 0.dp
    val first = al[0].year
    if (ui.band && ui.formed != null && (first == null || ui.formed < first)) {
        marks += Mark(0.dp, "${ui.formed} · группа собралась", false)
        y = 50.dp
        segs += Seg(12.dp, y + 11.dp, first != null && first - ui.formed > 6)
    }
    al.forEachIndexed { i, x ->
        var top = y
        if (i > 0) {
            val prev = al[i - 1].year
            val gap = if (x.year != null && prev != null) x.year - prev else 0
            if (gap > 6) {
                val gy = tops[i - 1] + g.block + 16.dp
                marks += Mark(gy, "$gap ${yearsW(gap)}", true)
                top = gy + 52.dp
                segs += Seg(tops[i - 1] + 11.dp, top + 11.dp, true)
            } else {
                top = tops[i - 1] + g.step
                segs += Seg(tops[i - 1] + 11.dp, top + 11.dp, false)
            }
        }
        tops += top
    }
    var end = tops.last() + g.block
    if (ui.dead && ui.end != null) {
        val last = al.last().year ?: ui.end
        val gy = end + 18.dp
        marks += Mark(gy, "✝ ${ui.end}", false)
        segs += Seg(tops.last() + 11.dp, gy + 12.dp, ui.end - last > 6)
        end = gy + 34.dp
    }
    val ink = c.text
    // the water rises in turn: 60 ms apart for covers coming into view together
    val queue = remember { WaterQueue() }
    Box(Modifier.width(w).height(end)) {
        Canvas(Modifier.matchParentSize()) {
            val x = size.width / 2f
            for (s in segs) {
                val y0 = s.y0.toPx(); val y1 = s.y1.toPx()
                if (y1 <= y0) continue
                if (s.gap) drawLine(ink.copy(alpha = 0.26f), Offset(x, y0), Offset(x, y1), 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 6.dp.toPx())))
                else drawLine(ink.copy(alpha = 0.16f), Offset(x, y0), Offset(x, y1), 1.5.dp.toPx())
            }
        }
        for (m in marks) Box(Modifier.offset(y = m.y).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            if (m.gap) Text(m.text, Modifier.background(c.bg).padding(horizontal = 10.dp), style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textSubtle))
            else Text(m.text, Modifier.background(c.bg, RoundedCornerShape(12.dp)).hairline(12.dp).padding(horizontal = 12.dp, vertical = 4.dp),
                style = MusixTheme.text.caption.copy(fontSize = 12.5.sp, color = c.textMuted), maxLines = 1)
        }
        al.forEachIndexed { i, x ->
            val left = i % 2 == 0
            Column(Modifier.offset(x = if (left) g.xl else g.xr, y = tops[i]).width(g.s)) {
                AxisCover(x, g.s, left, ui.standing.level, queue, onOpen)
                Column(Modifier.padding(top = 9.dp)) {
                    Text(x.clean,
                        Modifier.flightSpot(FlightKey.albumTitle(x.id), FlightKind.Word, text = 14.5.sp).pointerInput(x.id) { detectTapGestures { onOpen(x) } }
                            .semantics { role = Role.Button },
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        style = MusixTheme.text.body.copy(fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 18.sp, letterSpacing = (-0.01).em, color = c.text))
                    Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (x.ed != null) Badge(x.ed, Modifier.weight(1f, fill = false))
                        Text(statText(x), maxLines = 1, style = MusixTheme.text.number.copy(fontSize = 12.sp, color = c.textSubtle))
                    }
                }
            }
            Box(
                Modifier.offset(x = w / 2 - 18.dp, y = tops[i]).size(36.dp, 22.dp).background(c.bg, RoundedCornerShape(11.dp)).hairline(11.dp),
                contentAlignment = Alignment.Center,
            ) { Text(x.year?.toString() ?: "—", style = MusixTheme.text.number.copy(fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = if (x.heard > 0) c.text else c.textSubtle)) }
        }
    }
}

@Composable
private fun Modifier.hairline(r: Dp): Modifier {
    val line = if (MusixTheme.isDark) Color.White.copy(alpha = 0.12f) else Color.Black.copy(alpha = 0.10f)
    return drawBehind { drawRoundRect(line, cornerRadius = CornerRadius(r.toPx()), style = Stroke(1.dp.toPx())) }
}

@Composable
internal fun Badge(text: String, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    Text(text, modifier.hairline(6.dp).padding(horizontal = 6.dp, vertical = 1.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
        style = MusixTheme.text.caption.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium, color = c.textMuted))
}

/** The axis covers rise one after another when they come into view together. */
private class WaterQueue {
    var n = 0
    var last = 0L
    fun delay(): Long {
        val now = android.os.SystemClock.uptimeMillis()
        if (now - last > 150) n = 0
        last = now
        return 60L * n++
    }
}

private val Water = CubicBezierEasing(0.3f, 0.7f, 0.2f, 1f)
private fun greyMatrix(dark: Boolean): ColorMatrix {
    // grayscale(1) brightness(.7) contrast(.9) on dark, brightness(1.08) contrast(.82) on light
    val b = if (dark) 0.7f else 1.08f
    val k = if (dark) 0.9f else 0.82f
    val off = b * 127.5f * (1f - k)
    val r = b * k * 0.2126f; val gg = b * k * 0.7152f; val bb = b * k * 0.0722f
    return ColorMatrix(floatArrayOf(r, gg, bb, 0f, off, r, gg, bb, 0f, off, r, gg, bb, 0f, off, 0f, 0f, 0f, 1f, 0f))
}

/** A cover of the axis: the grey picture, the colour risen in it to [Disc.p], the vinyl behind. */
@Composable
private fun AxisCover(x: Disc, s: Dp, left: Boolean, level: Level, queue: WaterQueue, onOpen: (Disc) -> Unit) {
    val dark = MusixTheme.isDark
    val reduced = rememberReducedMotion()
    val p = x.p
    val rise = remember(x.id) { Animatable(if (reduced || p <= 0f) p else 0f) }
    var seen by remember(x.id) { mutableStateOf(reduced || p <= 0f) }
    val check = remember(x.id) { Animatable(if (seen) 1f else 0f) }
    val press = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val spec = remember { springOf<Float>(0.42f, 0.72f) }
    val grey = remember(dark) { ColorFilter.colorMatrix(greyMatrix(dark)) }
    val small = x.image?.url(256)
    LaunchedEffect(seen) {
        if (!seen || rise.value >= p) return@LaunchedEffect
        delay(queue.delay())
        launch { rise.animateTo(p, tween(700, easing = Water)) }
        if (p >= 1f) { delay(640); check.animateTo(1f, springOf(0.42f, 0.55f)) }
    }
    Box(
        Modifier.size(s).onGloballyPositioned { co ->
            if (seen) return@onGloballyPositioned
            val b = co.boundsInRoot()
            if (b.height >= co.size.height * 0.35f) seen = true
        },
    ) {
        // the vinyl: it comes out from under the cover while the finger holds it
        Box(Modifier.fillMaxSize().padding(s * 0.03f).graphicsLayer {
            val k = press.value
            translationX = (if (left) 1f else -1f) * s.toPx() * 0.14f * k
            rotationZ = (if (left) 28f else -28f) * k
        }.shadow(10.dp, CircleShape).clip(CircleShape).drawBehind { drawVinyl() }) {
            AsyncImage(small, null, Modifier.fillMaxSize(0.34f).align(Alignment.Center).clip(CircleShape), contentScale = ContentScale.Crop)
        }
        Box(
            Modifier.fillMaxSize().flightSpot(FlightKey.albumCover(x.id))
                .graphicsLayer { val k = 1f - 0.02f * press.value; scaleX = k; scaleY = k }
                .shadow(14.dp, RoundedCornerShape(8.dp), ambientColor = Color.Black, spotColor = Color.Black.copy(alpha = if (dark) 0.6f else 0.3f))
                .clip(RoundedCornerShape(8.dp)).background(MusixTheme.colors.bg)
                .semantics { role = Role.Button; contentDescription = "Открыть «${x.clean}», ${statText(x)}" }
                .pointerInput(x.id) {
                    detectTapGestures(
                        onPress = {
                            scope.launch { press.animateTo(1f, spec) }
                            val up = tryAwaitRelease()
                            scope.launch { if (up) delay(140); press.animateTo(0f, spec) }
                        },
                        onTap = { onOpen(x) },
                    )
                },
        ) {
            AsyncImage(small, null, Modifier.fillMaxSize().graphicsLayer { alpha = if (dark) 0.62f else 0.5f }, contentScale = ContentScale.Crop, colorFilter = grey)
            if (p > 0f) {
                // the colour, clipped from the bottom up to the water line
                Box(Modifier.fillMaxSize().graphicsLayer {
                    clip = true
                    shape = TopCut(1f - rise.value)
                }.drawWithContent {
                    drawContent()
                    // the water line: a bright hairline with a little glow under it
                    if (p < 1f) {
                        val y = (1f - rise.value) * size.height
                        drawRect(Brush.verticalGradient(0f to Color.White.copy(alpha = 0.32f), 1f to Color.Transparent, startY = y, endY = y + 8.dp.toPx()), Offset(0f, y), Size(size.width, 8.dp.toPx()))
                        drawRect(Color.White.copy(alpha = 0.9f), Offset(0f, y), Size(size.width, 1.5.dp.toPx()))
                    }
                }) {
                    AsyncImage(small, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                }
            }
            if (p >= 1f) Box(
                Modifier.align(Alignment.BottomEnd).padding(7.dp).size(22.dp).graphicsLayer { val k = check.value; alpha = k.coerceIn(0f, 1f); scaleX = 0.4f + 0.6f * k; scaleY = 0.4f + 0.6f * k }
                    .shadow(4.dp, CircleShape).background(Brush.linearGradient(level.face), CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(MusixIcons.Check, "дослушан", Modifier.size(13.dp), tint = Color(0xFF20180A)) }
        }
    }
}

/** A rectangle with its top [cut] (0..1 of the height) taken away: the water's body. */
private class TopCut(private val cut: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline =
        Outline.Rectangle(androidx.compose.ui.geometry.Rect(0f, size.height * cut.coerceIn(0f, 1f), size.width, size.height))
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawVinyl() {
    val r = size.minDimension / 2f
    drawCircle(Color(0xFF0A0A0B), r)
    val step = 2.5.dp.toPx()
    var q = r
    while (q > r * 0.36f) {
        drawCircle(Color(0xFF18181B), q, style = Stroke(1.1.dp.toPx()))
        q -= step
    }
    drawCircle(Color.White.copy(alpha = 0.08f), 1.dp.toPx())
}

/** One album: the cover, and beside it what it is to the listener. */
@Composable
private fun SoloAlbum(ui: ArtistUi, x: Disc, w: Dp, onOpen: (Disc) -> Unit) {
    val c = MusixTheme.colors
    val s1 = (w.value * 0.46f).roundToInt().dp
    val pad = pagePad(w)
    val queue = remember { WaterQueue() }
    Row(Modifier.fillMaxWidth().padding(horizontal = pad), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        AxisCover(x, s1, true, ui.standing.level, queue, onOpen)
        Column(Modifier.weight(1f)) {
            if (x.year != null) Text("${x.year}", style = MusixTheme.text.number.copy(fontSize = 12.5.sp, color = c.textSubtle))
            Text(x.clean, Modifier.padding(top = 4.dp).flightSpot(FlightKey.albumTitle(x.id), FlightKind.Word, text = 20.sp).pointerInput(x.id) { detectTapGestures { onOpen(x) } },
                style = MusixTheme.text.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold, lineHeight = 23.6.sp, letterSpacing = (-0.02).em, color = c.text))
            Text(statText(x), Modifier.padding(top = 6.dp), style = MusixTheme.text.number.copy(fontSize = 12.5.sp, color = c.textSubtle))
            Text("Единственный альбом ${ui.name} в твоей библиотеке.", Modifier.padding(top = 10.dp),
                style = MusixTheme.text.reading.copy(fontSize = 13.5.sp, lineHeight = 19.5.sp, color = c.textMuted))
        }
    }
}
