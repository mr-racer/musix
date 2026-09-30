package ru.musixai.app.feature.artist

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import ru.musixai.app.core.designsystem.hexColor
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.ArtistPage

private enum class HeroMode { Cutout, Photo, Aurora }

/**
 * v1 `AtlasHero` in its phone form: a full-width band (the cutout standing on a field in the
 * artist's hue, else the photo, else an aurora from the album covers), the breadcrumb over it,
 * then the name, the origin line with the flag, the years and the catalogue, the Grammy chip
 * and «Включить артиста». v1 gave the phone no parallax, rays or slide-in — neither does this.
 */
@Composable
internal fun ArtistHero(page: ArtistPage, playingHere: Boolean, onBack: () -> Unit, onPlay: () -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val name = page.artist.name
    val hue = atlasHue(name)
    val photo = page.artist.imageId?.let { page.images[it] }
    val mode = when { page.cutout != null -> HeroMode.Cutout; photo != null -> HeroMode.Photo; else -> HeroMode.Aurora }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val w = maxWidth
        val band = if (mode == HeroMode.Aurora) (w * 0.36f).coerceIn(150.dp, 210.dp) else (w * 0.62f).coerceIn(230.dp, 340.dp)
        Column {
            Box(Modifier.fillMaxWidth().height(band).clipToBounds()) {
                when (mode) {
                    HeroMode.Cutout -> {
                        // radial-gradient(ellipse 110% 96% at 50% 18%, …): a circle squashed to the ellipse
                        Canvas(Modifier.fillMaxSize()) {
                            val rx = size.width * 1.10f
                            val k = size.height * 0.96f / rx
                            val ctr = Offset(size.width / 2, size.height * 0.18f)
                            scale(1f, k, ctr) {
                                drawRect(Brush.radialGradient(
                                    0f to (if (dark) oklch(23f, 0.02f, hue) else oklch(96f, 0.012f, hue)),
                                    0.62f to (if (dark) oklch(14f, 0.012f, hue) else oklch(92f, 0.01f, hue)),
                                    1f to Color.Transparent, center = ctr, radius = rx),
                                    topLeft = Offset(0f, ctr.y - ctr.y / k), size = androidx.compose.ui.geometry.Size(size.width, size.height / k))
                            }
                        }
                        AsyncImage(page.cutout?.url(1024), null,
                            Modifier.align(Alignment.BottomCenter).fillMaxWidth().fillMaxHeight().padding(top = 8.dp)
                                .fade(0f to Color.Transparent, 0.07f to Color.Black),
                            contentScale = ContentScale.Fit, alignment = Alignment.BottomCenter)
                    }
                    HeroMode.Photo -> AsyncImage(photo?.url(1024), null,
                        Modifier.fillMaxSize().fade(0.88f to Color.Black, 1f to Color.Transparent),
                        contentScale = ContentScale.Crop, alignment = BiasAlignment(0f, -0.4f),
                        colorFilter = if (dark) ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(1.04f); timesAssign(ColorMatrix().apply { setToScale(0.94f, 0.94f, 0.94f, 1f) }) }) else null)
                    HeroMode.Aurora -> {
                        val stops = auroraStops(page, hue, dark)
                        Canvas(Modifier.fillMaxSize().fade(0.7f to Color.Black, 1f to Color.Transparent)) {
                            // css 150°: toward the lower right, the line long enough to cover the corners
                            val dir = Offset(0.5f, 0.866f)
                            val half = (size.width * 0.5f + size.height * 0.866f) / 2f
                            val mid = Offset(size.width / 2, size.height / 2)
                            drawRect(Brush.linearGradient(stops, mid - dir * half, mid + dir * half))
                        }
                    }
                }
                // the breadcrumb's readability veil, then the crumb (and the back key Android needs)
                Box(Modifier.fillMaxWidth().fillMaxHeight(0.34f).background(Brush.verticalGradient(
                    listOf(if (dark) Color(0x590D0D10) else Color(0x4DF2F1F6), Color.Transparent))))
                Row(Modifier.padding(start = 10.dp, top = 8.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    RoundGlassButton(onBack, size = 34.dp) { Icon(MusixIcons.ChevronLeft, "Назад", Modifier.size(16.dp), tint = c.text) }
                    Spacer(Modifier.width(10.dp))
                    Text(buildAnnotatedString {
                        append("БИБЛИОТЕКА / ")
                        withStyle(SpanStyle(color = if (dark) Color.White else Color(0xFF161620))) { append(name.uppercase()) }
                    }, Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MusixTheme.type.mono.copy(fontSize = 10.sp, letterSpacing = 0.2.em, color = if (dark) Color(0x99FFFFFF) else Color(0x99141220)))
                    if (playingHere) { Spacer(Modifier.width(10.dp)); CrumbEq(if (dark) Color.White else Color(0xFF161620)) }
                }
            }
            // name + meta, in normal flow on the page background
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp)) {
                Text(name, style = MusixTheme.type.serif.copy(fontSize = (w.value * 0.086f).coerceIn(28f, 42f).sp, fontWeight = FontWeight.Light,
                    lineHeight = 1.05.em, letterSpacing = (-0.025).em, color = c.text))
                originLine(page)?.let {
                    Text(it, Modifier.padding(top = 9.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = MusixTheme.type.mono.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.16.em,
                            color = if (dark) Color(0xF5E4DBFF) else oklch(34f, 0.16f, 282f)))
                }
                val meta = MusixTheme.type.mono.copy(fontSize = 12.sp, letterSpacing = 0.14.em, color = if (dark) Color(0xB3D2CAE4) else oklch(46f, 0.05f, 282f))
                val counts = countsLine(page)
                val years = yearsLine(page.facets)
                Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (years != null) Text(listOfNotNull(years, counts).joinToString(" · ").uppercase(), style = meta)
                    else {
                        decades(page)?.let { d ->
                            Text(buildAnnotatedString {
                                withStyle(SpanStyle(color = meta.color.copy(alpha = meta.color.alpha * 0.78f))) { append("Десятилетия в твоей библиотеке") }
                                append(" · $d")
                            }, style = meta.copy(letterSpacing = 0.12.em))
                        }
                        counts?.let { Text(it, style = meta) }
                    }
                }
                Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    GrammyChip(page.facets["grammy_wins"]?.toIntOrNull() ?: 0, page.facets["grammy_nominations"]?.toIntOrNull() ?: 0, dark)
                    AtlasPlay(playingHere, dark, onPlay)
                }
            }
        }
    }
}

/** A mask along the height: the stops say where the layer shows (black) or not. */
private fun Modifier.fade(vararg stops: Pair<Float, Color>) = graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent { drawContent(); drawRect(Brush.verticalGradient(*stops), blendMode = BlendMode.DstIn) }

/** v1 `atlasHue`: a stable hue from the name's first two letters. */
private fun atlasHue(name: String): Float {
    val a = name.firstOrNull()?.code ?: 65
    val b = name.getOrNull(1)?.code ?: a
    return ((a * 37 + b * 17) % 360).toFloat()
}

/** v1 `auroraStops(padPalette(…))`: the album covers' colours (else a name hue), clamped to bands that read on both themes. */
private fun auroraStops(page: ArtistPage, hue: Float, dark: Boolean): List<Color> {
    val hsl = page.albums.mapNotNull { a -> a.image?.palette?.dominant?.let(::hexColor) }.map(::toHsl)
        .distinctBy { (it[0] / 20).toInt() }.take(4)
        .ifEmpty { listOf(floatArrayOf(hue, 60f, 55f), floatArrayOf((hue + 45) % 360, 52f, 50f), floatArrayOf((hue + 330) % 360, 46f, 60f)) }
        .toMutableList()
    val spread = listOf(18f, -24f, 30f, -14f); val lift = listOf(8f, -10f, 5f, -6f)
    var i = 0
    while (hsl.size < 3) { val b = hsl[0]; hsl += floatArrayOf(((b[0] + spread[i]) % 360 + 360) % 360, b[1].coerceIn(30f, 80f), (b[2] + lift[i]).coerceIn(20f, 80f)); i++ }
    return hsl.map { (h, s, l) -> Color.hsl(h, s.coerceIn(38f, 72f) / 100f, (if (dark) l.coerceIn(38f, 56f) else l.coerceIn(58f, 74f)) / 100f) }
}

private fun toHsl(col: Color): FloatArray {
    val r = col.red; val g = col.green; val b = col.blue
    val max = maxOf(r, g, b); val min = minOf(r, g, b); val l = (max + min) / 2
    if (max == min) return floatArrayOf(0f, 0f, l * 100)
    val d = max - min
    val s = if (l > 0.5f) d / (2 - max - min) else d / (max + min)
    val h = when (max) { r -> (g - b) / d + (if (g < b) 6 else 0); g -> (b - r) / d + 2; else -> (r - g) / d + 4 } * 60
    return floatArrayOf(h, s * 100, l * 100)
}

/** Genre · 🇺🇸 NEW YORK, USA — the most specific place known. */
private fun originLine(page: ArtistPage): String? {
    val genre = page.topTracks.mapNotNull { it.genre }.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key
    val place = page.facets["formed_place"] ?: page.country ?: page.countryCode
    val flag = page.countryCode?.takeIf { it.length == 2 && it.all(Char::isLetter) }?.uppercase()
        ?.map { String(Character.toChars(0x1F1E6 + (it - 'A'))) }?.joinToString("")
    return listOfNotNull(genre?.uppercase(), place?.let { if (flag != null) "$flag ${it.uppercase()}" else it.uppercase() })
        .takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/** v1 `atlasYearsLine`: «1996 — сейчас», «1994 — 2009», «1996 — пауза», «с 1971». */
private fun yearsLine(f: Map<String, String>): String? {
    val from = f["active_from"] ?: f["formed_year"] ?: return null
    val to = f["active_to"]; val st = f["status"]
    return when {
        to != null -> "$from — $to" + if (st == "hiatus") " · пауза" else ""
        st == "disbanded" -> "$from — распались"
        st == "hiatus" -> "$from — пауза"
        st == "deceased" -> "с $from"
        else -> "$from — сейчас"
    }
}

private fun ruPlural(n: Int, one: String, few: String, many: String) =
    if (n % 10 == 1 && n % 100 != 11) one else if (n % 10 in 2..4 && n % 100 !in 12..14) few else many

private fun countsLine(page: ArtistPage): String? = listOfNotNull(
    page.albums.size.takeIf { it > 0 }?.let { "$it ${ruPlural(it, "АЛЬБОМ", "АЛЬБОМА", "АЛЬБОМОВ")}" },
    page.trackCount.takeIf { it > 0 }?.let { "$it ${ruPlural(it, "ТРЕК", "ТРЕКА", "ТРЕКОВ")}" },
).takeIf { it.isNotEmpty() }?.joinToString(" · ")

private fun decades(page: ArtistPage): String? {
    val years = (page.topTracks + page.appearsOn).mapNotNull { it.year }.filter { it > 0 }
    if (years.isEmpty()) return null
    val a = years.min() / 10 * 10; val b = years.max() / 10 * 10
    return if (a == b) "${a}S" else "${a}S–${b}S"
}

/** v1 `GrammyChip`: gold liquid glass with the wins; nominations alone get the quiet outline. */
@Composable
private fun GrammyChip(wins: Int, noms: Int, dark: Boolean) {
    if (wins == 0 && noms == 0) return
    val gold = if (dark) oklch(78f, 0.13f, 90f) else oklch(52f, 0.17f, 90f)
    val shape = RoundedCornerShape(99.dp)
    val body = if (wins > 0) Modifier.dropShadow(shape, Shadow(radius = 22.dp, color = gold.copy(alpha = if (dark) 0.28f else 0.18f)))
        .background(Brush.linearGradient(listOf(gold.copy(alpha = 0.3f), gold.copy(alpha = 0.08f), gold.copy(alpha = 0.16f))), shape)
        .innerShadow(shape, Shadow(radius = 0.dp, color = Color.White.copy(alpha = if (dark) 0.38f else 0.9f), offset = DpOffset(0.dp, 1.dp)))
    else Modifier.graphicsLayer { alpha = 0.78f }
    Row(body.border(1.dp, gold.copy(alpha = if (dark) 0.42f else 0.38f), shape).padding(start = 10.dp, end = 13.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        GrammyIcon(gold, filled = wins > 0)
        val label = MusixTheme.type.mono.copy(fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.18.em, color = gold)
        if (wins > 0) Text(buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, fontSize = 12.5.sp, letterSpacing = 0.1.em)) { append("$wins") }
            append(" GRAMMY")
        }, style = label)
        else Text("GRAMMY · $noms ${ruPlural(noms, "НОМИНАЦИЯ", "НОМИНАЦИИ", "НОМИНАЦИЙ")}", style = label)
    }
}

/** The gramophone of v1's chip (its 20-unit svg). */
@Composable
private fun GrammyIcon(col: Color, filled: Boolean) {
    Canvas(Modifier.size(13.dp)) {
        val u = size.width / 20f
        val stroke = androidx.compose.ui.graphics.drawscope.Stroke(1.2f * u)
        val horn = Path().apply { moveTo(6.3f * u, 1.7f * u); lineTo(12.85f * u, 11.15f * u); lineTo(11.15f * u, 12.85f * u); lineTo(1.7f * u, 6.3f * u); close() }
        if (filled) drawPath(horn, col); drawPath(horn, col, style = stroke)
        if (filled) drawCircle(col.copy(alpha = col.alpha * 0.45f), 3.2f * u, Offset(4f * u, 4f * u))
        drawCircle(col, 3.2f * u, Offset(4f * u, 4f * u), style = androidx.compose.ui.graphics.drawscope.Stroke(1.1f * u))
        drawLine(col, Offset(12f * u, 12f * u), Offset(13.6f * u, 14.2f * u), 1.5f * u, androidx.compose.ui.graphics.StrokeCap.Round)
        val base = androidx.compose.ui.geometry.RoundRect(9f * u, 14f * u, 18.5f * u, 18.2f * u, androidx.compose.ui.geometry.CornerRadius(1.2f * u))
        val bp = Path().apply { addRoundRect(base) }
        if (filled) drawPath(bp, col); drawPath(bp, col, style = stroke)
    }
}

/**
 * v1 «Включить артиста» (`.atlas-play-cap.is-block`): a glass capsule with a lit violet key
 * set into a socket. The key sinks when pressed; while the artist plays it breathes its glow
 * (atlasKeyPulse 2.6 s) and shows the four-bar equalizer.
 */
@Composable
private fun AtlasPlay(playing: Boolean, dark: Boolean, onClick: () -> Unit) {
    val c = MusixTheme.colors
    val shape = RoundedCornerShape(99.dp)
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val t = rememberInfiniteTransition(label = "key")
    val pulse by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1300), RepeatMode.Reverse), label = "pulse")
    val glow = if (playing) pulse else 0.2f
    Row(
        Modifier.fillMaxWidth()
            .dropShadow(shape, Shadow(radius = if (dark) 38.dp else 30.dp, color = if (dark) Color(0x6B000000) else Color(0x24281E46), offset = DpOffset(0.dp, 14.dp)))
            .background(if (dark) Color(0x8C151221) else Color(0x9EFFFFFF), shape)
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x29FFFFFF) else Color(0xF2FFFFFF), offset = DpOffset(0.dp, 1.dp)))
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x40000000) else Color(0x0D000000), offset = DpOffset(0.dp, (-1).dp)))
            .border(1.dp, if (dark) Color(0x21FFFFFF) else Color(0xB3FFFFFF), shape)
            .clip(shape)
            .clickable(interactionSource = src, indication = null, onClick = onClick)
            .padding(start = 5.dp, top = 5.dp, bottom = 5.dp, end = 28.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        // the socket
        Box(Modifier.size(38.dp).clip(CircleShape)
            .drawBehind {  // radial-gradient(circle at 50% 35%, …) to the farthest corner
                drawCircle(Brush.radialGradient(listOf(if (dark) Color(0x9E000000) else Color(0x42000000), if (dark) Color(0x61000000) else Color(0x1F000000)),
                    Offset(size.width * 0.5f, size.height * 0.35f), size.width * 0.82f))
            }
            .innerShadow(CircleShape, Shadow(radius = 4.dp, color = if (dark) Color(0xB3000000) else Color(0x59000000), offset = DpOffset(0.dp, 2.dp)))
            .innerShadow(CircleShape, Shadow(radius = 0.dp, color = if (dark) Color(0x24FFFFFF) else Color(0xB3FFFFFF), offset = DpOffset(0.dp, (-1).dp))),
            contentAlignment = Alignment.Center) {
            // the key
            Box(Modifier.size(30.dp)
                .graphicsLayer { val s = if (pressed) 0.97f else 1f; scaleX = s; scaleY = s; translationY = if (pressed) 1.5.dp.toPx() else 0f }
                .dropShadow(CircleShape, Shadow(radius = (14 + 10 * glow).dp, color = oklch(60f + 6f * glow, 0.18f, 270f, alpha = 0.5f + 0.35f * glow)))
                .dropShadow(CircleShape, Shadow(radius = 8.dp, color = Color(0x73000000), offset = DpOffset(0.dp, 3.dp)))
                .clip(CircleShape)
                .drawBehind {  // circle at 35% 28%, to the farthest corner
                    drawCircle(Brush.radialGradient(0f to oklch(82f, 0.13f, 275f), 0.42f to oklch(63f, 0.2f, 272f), 1f to oklch(48f, 0.2f, 283f),
                        center = Offset(size.width * 0.35f, size.height * 0.28f), radius = size.width * 0.97f))
                }
                .innerShadow(CircleShape, Shadow(radius = 1.dp, color = Color(0x99FFFFFF), offset = DpOffset(0.dp, 1.dp)))
                .innerShadow(CircleShape, Shadow(radius = 3.dp, color = Color(0x6B000000), offset = DpOffset(0.dp, (-2).dp))),
                contentAlignment = Alignment.Center) {
                if (playing) KeyEq() else Icon(MusixIcons.Play, null, Modifier.size(11.dp).offset(x = 1.dp), tint = Color.White)
            }
        }
        Spacer(Modifier.width(12.dp))
        Text(if (playing) "СЕЙЧАС ИГРАЕТ" else "ВКЛЮЧИТЬ АРТИСТА", maxLines = 1,
            style = MusixTheme.type.mono.copy(fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.18.em, color = if (dark) Color.White else Color(0xFF161620)))
    }
}

/** v1 `.atlas-eq`: four white bars, 1.15 s, out of phase. */
@Composable
private fun KeyEq() {
    val t = rememberInfiniteTransition(label = "eq")
    val p by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1150, easing = androidx.compose.animation.core.LinearEasing)), label = "p")
    Canvas(Modifier.size(width = 14.dp, height = 12.dp)) {
        val hi = listOf(9f, 12f, 7f, 11f); val lag = listOf(0.15f, 0.6f, 0.9f, 0.35f)
        for (i in 0..3) {
            val ph = ((p + lag[i] / 1.15f) % 1f)
            val k = 0.5f - 0.5f * kotlin.math.cos(ph * 2f * Math.PI.toFloat())
            val h = (3f + (hi[i] - 3f) * k).dp.toPx()
            val x = i * 4.dp.toPx()
            drawRoundRect(Color.White, Offset(x, size.height - h), androidx.compose.ui.geometry.Size(2.dp.toPx(), h), androidx.compose.ui.geometry.CornerRadius(1.dp.toPx()))
        }
    }
}

/** The crumb's `.hero-eq` while this artist plays. */
@Composable
private fun CrumbEq(col: Color) {
    val t = rememberInfiniteTransition(label = "crumb")
    val p by t.animateFloat(0f, 6.283f, infiniteRepeatable(tween(1400)), label = "p")
    Canvas(Modifier.size(width = 16.dp, height = 10.dp)) {
        val bw = size.width / 8f
        for (i in 0..4) {
            val h = size.height * (0.35f + 0.65f * (0.5f + 0.5f * kotlin.math.sin(p + i * 1.1f)))
            drawRoundRect(col, Offset(i * bw * 1.6f, size.height - h), androidx.compose.ui.geometry.Size(bw, h), androidx.compose.ui.geometry.CornerRadius(bw / 2))
        }
    }
}
