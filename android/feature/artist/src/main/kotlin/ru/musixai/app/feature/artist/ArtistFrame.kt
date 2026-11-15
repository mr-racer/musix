package ru.musixai.app.feature.artist

import ru.musixai.app.core.designsystem.motion.FlightKind
import ru.musixai.app.core.designsystem.motion.flightSpot
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.CornerRadius
import ru.musixai.app.core.designsystem.text
import android.os.Build
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import coil3.compose.AsyncImage
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.Skel
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.EnvelopeSprings
import ru.musixai.app.core.designsystem.motion.FlightSpot
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

/** The frame's height: a little taller than wide, never more than 56 % of the page (the mock's `fh`). */
internal fun frameHeight(w: Dp, h: Dp): Dp = minOf(w * 1.12f, h * 0.56f)

/** The name's size by the phone's width (38 / 44 / 48 sp, as the mock's `--nfs`). */
internal fun nameSize(w: Dp): TextUnit = if (w < 380.dp) 38.sp else if (w < 420.dp) 44.sp else 48.sp

/** The glass play on the frame, at the right of the facts; its bottom on the words' bottom ([FrameTextBottom]). */
internal val PlaySize = 56.dp
internal val FrameTextBottom = 52.dp

/** The page's side padding by width (16 / 20 / 24). */
internal fun pagePad(w: Dp): Dp = if (w < 380.dp) 16.dp else if (w < 420.dp) 20.dp else 24.dp

private fun smootherstep(x: Float): Float = x * x * x * (x * (x * 6f - 15f) + 10f)

/** The bottom [fade] of the frame (web `--photo-fade`): opaque, then gone along a smootherstep —
 *  a linear ramp shows its first stop as a seam. [amount] 0 = no fade (a photo in flight). */
internal fun photoFade(height: Float, fade: Float, amount: Float): Brush {
    val stops = ArrayList<Pair<Float, Color>>(12)
    stops += 0f to Color.Black
    for (i in 0..10) {
        val y = (height - fade * (1f - i / 10f)).coerceAtLeast(0f) / height
        stops += y.coerceIn(0f, 1f) to Color.Black.copy(alpha = 1f - amount * smootherstep(i / 10f))
    }
    return Brush.verticalGradient(*stops.toTypedArray(), startY = 0f, endY = height)
}

/** The page colour darkened for the frame's lower shade (`--pagedark`). */
internal fun pageDark(page: Color): Color = lerp(Color(0xFF07070A), page, 0.26f)

private val PhotoAlign = BiasAlignment(0f, -0.52f)   // object-position: 50% 24%
private val LightPhoto = ColorFilter.colorMatrix(ColorMatrix().apply { setToScale(0.72f, 0.72f, 0.72f, 1f) })

/**
 * The picture of the frame: the photo, its blurred lower part (the server's pre-blurred `bg`, so
 * no blur runs on the phone; API 31+ blurs a copy when there is none), the shade and the bottom
 * fade. [fx] brings the effects in (0 = the bare photo, 1 = the page's frame): a photo flying in
 * from a circle grows its blur, shade and fade on the way, so it lands as the frame it becomes
 * (the owner, 2026-11-15: «резко превращается в размытое»).
 */
@Composable
internal fun FrameArt(ui: ArtistUi?, fx: () -> Float, modifier: Modifier = Modifier) {
    val dark = MusixTheme.isDark
    val page = ui?.page ?: if (dark) Color(0xFF111111) else MusixTheme.colors.plate
    val pd = pageDark(page)
    val photo = ui?.photo
    val light = ui?.light == true
    Box(
        modifier.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                drawRect(photoFade(size.height, 56.dp.toPx(), fx()), blendMode = BlendMode.DstIn)
            }
            .background(page),
    ) {
        if (photo != null) {
            AsyncImage(photo.url(1024), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = PhotoAlign,
                colorFilter = if (light) LightPhoto else null)
            // the lower half, blurred: the words stand on it
            val soft = photo.bg
            val canBlur = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            if (soft != null || canBlur) Box(
                Modifier.fillMaxSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen; alpha = fx() }
                    .drawWithContent {
                        drawContent()
                        drawRect(Brush.verticalGradient(0.5f to Color.Transparent, 0.82f to Color.Black), blendMode = BlendMode.DstIn)
                    },
            ) {
                AsyncImage(
                    soft ?: photo.url(256), null,
                    Modifier.fillMaxSize().graphicsLayer { scaleX = 1.1f; scaleY = 1.1f }.then(if (soft == null) Modifier.blur(12.dp) else Modifier),
                    contentScale = ContentScale.Crop, alignment = PhotoAlign,
                    colorFilter = if (light) LightPhoto else null,
                )
            }
        }
        // the shade: a touch at the top (the status bar), the page's dark colour under the words
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = fx() }.drawWithContent {
            drawRect(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.38f), 1f to Color.Transparent, startY = 0f, endY = 104.dp.toPx()))
            val h = size.height
            drawRect(Brush.verticalGradient(
                0f to Color.Transparent, 0.38f to Color.Transparent, 0.70f to pd.copy(alpha = 0.55f),
                ((h - 26.dp.toPx()) / h).coerceIn(0.71f, 1f) to pd, 1f to pd,
            ))
        })
    }
}

/** The words of the frame: the name (or the logo) and two lines of facts, the Grammy among them. */
@Composable
internal fun FrameText(
    ui: ArtistUi?,
    w: Dp,
    modifier: Modifier = Modifier,
    nameSpot: Any? = null,
    onGrammy: ((LayoutCoordinates) -> Unit)? = null,
) {
    val pad = pagePad(w)
    Column(modifier.padding(start = pad, end = pad, bottom = FrameTextBottom)) {
        if (ui == null) {
            Skel(Modifier.size(220.dp, 40.dp), 8.dp)
            Spacer(Modifier.height(14.dp))
            Skel(Modifier.size(180.dp, 14.dp), 7.dp)
            Spacer(Modifier.height(10.dp))
            Skel(Modifier.size(130.dp, 14.dp), 7.dp)
            return@Column
        }
        // the name a word flies into (a name tapped on the album or in the player): its own spot
        val fs = nameSize(w).let { if (ui.name.length > 18) it * 0.8f else it }
        val nameMod = if (nameSpot != null) Modifier.flightSpot(nameSpot, FlightKind.Word, text = if (ui.logo == null) fs else TextUnit.Unspecified) else Modifier
        if (ui.logo != null) {
            AsyncImage(
                ui.logo.url(512), ui.name,
                nameMod.fillMaxWidth(0.76f).heightIn(max = 64.dp).semantics { heading() },
                contentScale = ContentScale.Fit, alignment = Alignment.BottomStart,
            )
        } else {
            Text(
                ui.name, nameMod.semantics { heading() },
                style = TextStyle(
                    fontFamily = MusixTheme.text.title.fontFamily, fontWeight = FontWeight.Bold, fontSize = fs,
                    lineHeight = fs * 0.98f, letterSpacing = (-0.02).em, color = Color.White,
                    shadow = Shadow(Color.Black.copy(alpha = 0.28f), Offset(0f, 2f), 26f),
                    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both),
                ),
            )
        }
        val facts = TextStyle(fontFamily = MusixTheme.text.body.fontFamily, fontWeight = FontWeight.Medium, fontSize = 14.sp, color = Color.White.copy(alpha = 0.88f))
        val sep = facts.copy(color = Color.White.copy(alpha = 0.4f))
        // the facts leave the glass play its corner and are at least as tall as it, so it never meets the name
        Column(Modifier.padding(top = 11.dp, end = PlaySize + 12.dp).heightIn(min = PlaySize - 11.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            val place = listOfNotNull(ui.country, ui.city)
            if (place.isNotEmpty()) Row(Modifier.heightIn(min = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                if (ui.flag != null) Text(ui.flag, style = facts.copy(fontSize = 15.sp))
                place.forEachIndexed { i, s -> if (i > 0) Text("·", style = sep); Text(s, style = facts, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            val second = listOfNotNull(ui.genre, ui.years)
            if (second.isNotEmpty() || ui.grammy != null) Row(Modifier.heightIn(min = 22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                second.forEachIndexed { i, s -> if (i > 0) Text("·", style = sep); Text(s, style = facts, maxLines = 1) }
                val g = ui.grammy
                if (g != null) {
                    if (second.isNotEmpty()) Text("·", style = sep)
                    GrammyChip(g.wins, g.nominations, onGrammy)
                }
            }
        }
    }
}

/* ── the Grammy: a laurel on each side of the number, gold for wins, a hollow outline for nominations ── */

private val Gold = Brush.linearGradient(listOf(Color(0xFFFFF4D2), Color(0xFFF0D48A), Color(0xFFD4A947), Color(0xFFB08029)), start = Offset(0f, 0f), end = Offset(3f, 30f))
internal val GoldText = Brush.linearGradient(listOf(Color(0xFFFFF4D2), Color(0xFFF0D48A), Color(0xFFD4A947), Color(0xFFA87A26)), start = Offset(0f, 0f), end = Offset(8f, 60f))

private fun laurelLeaves(w: Int) = if (w > 0) minOf(6, 1 + kotlin.math.ceil(w / 2.4).toInt()) else 2

/** The mock's `laurelPath`: [k] pairs of leaves along a quadratic stem in a 13 × 30 box. */
private fun laurelPath(k: Int): Path {
    val p0 = Offset(11.6f, 28.5f); val p1 = Offset(0.4f, 19f); val p2 = Offset(7.6f, 1.6f)
    fun at(t: Float) = p0 * ((1 - t) * (1 - t)) + p1 * (2 * (1 - t) * t) + p2 * (t * t)
    fun tan(t: Float): Offset { val v = (p1 - p0) * (2 * (1 - t)) + (p2 - p1) * (2 * t); val l = hypot(v.x, v.y); return Offset(v.x / l, v.y / l) }
    fun rot(d: Offset, a: Float) = Offset(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a))
    val path = Path()
    fun leaf(p: Offset, d: Offset, len: Float, w: Float) {
        val q = p + d * len; val m = p + d * (len * 0.5f); val n = Offset(-d.y * w, d.x * w)
        path.moveTo(p.x, p.y); path.quadraticTo(m.x + n.x, m.y + n.y, q.x, q.y); path.quadraticTo(m.x - n.x, m.y - n.y, p.x, p.y); path.close()
    }
    for (i in 0 until k) {
        val t = if (k == 1) 0.1f else 0.1f + i * 0.8f / (k - 1)
        val p = at(t); val tg = tan(t); val len = 5.4f - i * 1.2f / maxOf(1, k - 1)
        leaf(p, rot(tg, -0.62f), len, 1.55f); leaf(p, rot(tg, 0.55f), len * 0.78f, 1.3f)
    }
    leaf(at(0.97f), tan(0.97f), 4f, 1.4f)
    return path
}
private val LaurelStem = Path().apply { moveTo(11.6f, 28.5f); quadraticTo(0.4f, 19f, 7.6f, 1.6f) }

@Composable
private fun Laurel(k: Int, gold: Boolean, right: Boolean) {
    val leaves = remember(k) { laurelPath(k) }
    Canvas(Modifier.size(12.dp, 27.dp)) {
        val s = size.width / 13f
        withTransform({ if (right) scale(-1f, 1f, pivot = center); scale(s, s, pivot = Offset.Zero) }) {
            drawPath(LaurelStem, if (gold) Color(0xFFC99A3C) else Color(0xFFE3C37A).copy(alpha = 0.7f), style = Stroke(0.9f, cap = StrokeCap.Round))
            if (gold) drawPath(leaves, Gold) else drawPath(leaves, Color(0xFFE3C37A).copy(alpha = 0.85f), style = Stroke(0.8f))
        }
    }
}

@Composable
private fun GrammyChip(wins: Int, noms: Int, onOpen: ((LayoutCoordinates) -> Unit)?) {
    var coords by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val k = laurelLeaves(wins)
    val n = if (wins > 0) wins else noms
    Row(
        Modifier.offset(x = (-5).dp).height(30.dp).onGloballyPositioned { coords = it }
            .semantics { contentDescription = "Грэмми: $n" }
            .then(if (onOpen != null) Modifier.pressable(role = Press.Chip) { coords?.let(onOpen) } else Modifier)
            .padding(start = 5.dp, end = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Laurel(k, wins > 0, right = false)
        Text("$n", Modifier.padding(horizontal = 2.dp), style = TextStyle(
            fontFamily = MusixTheme.text.body.fontFamily, fontWeight = if (wins > 0) FontWeight.ExtraBold else FontWeight.SemiBold, fontSize = 17.sp,
            letterSpacing = (-0.03).em,
        ).let { if (wins > 0) it.copy(brush = GoldText) else it.copy(color = Color(0xD9F3DC9A)) })
        Laurel(k, wins > 0, right = true)
        Text(if (wins > 0) "Грэмми" else "${nomsW(noms)} Грэмми", Modifier.padding(start = 6.dp),
            style = TextStyle(fontFamily = MusixTheme.text.body.fontFamily, fontWeight = FontWeight.Medium, fontSize = 14.sp,
                color = if (wins > 0) Color(0xFFF3DC9A) else Color.White.copy(alpha = 0.9f)))
    }
}

/* the statue of the case (mock `statue`): a gramophone on a plinth, gold for a win, an outline for a nomination */
private val StatueHorn = PathParser().parsePathString("M9.3 14.6C9.5 11.6 10.9 9.4 13 7.8L15.3 1.6C17.4 2 19.4 3.9 20 6.2L14 9.2C12.2 10.5 11 12.2 10.7 14.6Z").toPath()

@Composable
internal fun Statue(win: Boolean, w: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(w, w * 1.5f)) {
        val s = size.width / 20f
        scale(s, s, pivot = Offset.Zero) {
            val outline = Color(0xFFD9B45A)
            if (win) {
                drawPath(StatueHorn, Gold)
                drawOval(Gold, Offset(3.7f, 13.8f), Size(12.6f, 3f))
                drawRoundRect(Gold, Offset(9.3f, 16.5f), Size(1.4f, 4.4f), CornerRadius(0.4f))
                drawRoundRect(Gold, Offset(7.4f, 20.7f), Size(5.2f, 1.3f), CornerRadius(0.55f))
                drawRoundRect(Brush.verticalGradient(listOf(Color(0xFF3A2A10), Color(0xFF1E1608)), startY = 22f, endY = 29.6f), Offset(3f, 22f), Size(14f, 7.6f), CornerRadius(1.1f))
                drawRoundRect(Color(0xFFE2BD63).copy(alpha = 0.85f), Offset(3.4f, 22f), Size(13.2f, 0.55f), CornerRadius(0.27f))
            } else {
                val st = Stroke(0.9f / 1f, join = StrokeJoin.Round)
                val a = 0.75f
                drawPath(StatueHorn, outline.copy(alpha = a), style = st)
                drawOval(outline.copy(alpha = a), Offset(3.7f, 13.8f), Size(12.6f, 3f), style = st)
                drawRoundRect(outline.copy(alpha = a), Offset(9.3f, 16.5f), Size(1.4f, 4.4f), CornerRadius(0.4f), style = st)
                drawRoundRect(outline.copy(alpha = a), Offset(7.4f, 20.7f), Size(5.2f, 1.3f), CornerRadius(0.55f), style = st)
                drawRoundRect(outline.copy(alpha = 0.55f), Offset(3.4f, 22.4f), Size(13.2f, 6.8f), CornerRadius(1f), style = st)
            }
        }
    }
}

/**
 * The photo growing out of the circle it was touched on into the frame (SourceFlight, picture →
 * picture): a window opens from the circle to the frame's rectangle while the frame's own effects
 * — the blurred lower half, the shade, the fade, the words — come in with it, so the landing is the
 * frame itself, not a sharp square swapped for a blurred one. The circle's own pixels lead the
 * first third (the page's photo may still be loading). [to] is read every frame: the page under it
 * is still coming into focus.
 */
@Composable
internal fun FrameFlight(spot: FlightSpot, from: Rect, ui: () -> ArtistUi?, to: () -> Rect?, w: Dp, frameH: Dp, onLand: () -> Unit, done: () -> Unit) {
    val k = remember { Animatable(0f) }
    DisposableEffect(spot) { spot.hold(); onDispose { spot.drop() } }
    val density = LocalDensity.current
    val tw = with(density) { w.toPx() }
    val th = with(density) { frameH.toPx() }
    LaunchedEffect(Unit) {
        // the page's frame is placed a frame or two after the page is composed
        var n = 0
        while (to() == null && n++ < 30) withFrameNanos { }
        val landed = booleanArrayOf(false)
        fun land() { if (!landed[0]) { landed[0] = true; onLand() } }
        // the frame takes over once the window has all but arrived: the spring's tail is the frame's own
        launch { snapshotFlow { k.value }.first { it >= 0.995f }; land() }
        k.animateTo(1f, EnvelopeSprings.flight())
        land()
        done()
    }
    val off = (th - tw).coerceAtLeast(0f) * 0.24f   // where the circle sits on the photo (object-position 24 %)
    Box(
        Modifier.size(w, frameH).graphicsLayer {
            val t = k.value
            val b = to() ?: Rect(0f, 0f, tw, th)
            val s0 = from.width / tw
            val s = s0 + (b.width / tw - s0) * t
            transformOrigin = TransformOrigin(0f, 0f)
            scaleX = s; scaleY = s
            translationX = from.left + (b.left - from.left) * t
            translationY = (from.top - off * s0) + (b.top - (from.top - off * s0)) * t
            // a new shape each frame: a layer recomputes its outline only when its shape changes
            shape = FlyWindow(off * (1f - t), (off + tw) + (th - off - tw) * t, (tw / 2f) * (1f - t))
            clip = true
        },
    ) {
        val u = ui()
        FrameArt(u, fx = { k.value }, Modifier.fillMaxSize())
        Box(Modifier.align(Alignment.BottomStart).graphicsLayer { alpha = ((k.value - 0.55f) / 0.45f).coerceIn(0f, 1f) }) {
            FrameText(u, w)
        }
        // the circle's own picture leads, then gives way to the page's photo
        Box(Modifier.fillMaxSize().graphicsLayer { alpha = if (u?.photo == null) 1f - ((k.value - 0.8f) / 0.2f).coerceIn(0f, 1f) else 1f - (k.value / 0.4f).coerceIn(0f, 1f) }
            .drawWithContent {
                val ps = tw / from.width
                translate(0f, off) { scale(ps, ps, pivot = Offset.Zero) { drawLayer(spot.picture) } }
            })
    }
}

/** The flyer's rounded window, between [top] and [bottom] of its own box. */
private class FlyWindow(private val top: Float, private val bottom: Float, private val radius: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline =
        Outline.Rounded(RoundRect(Rect(0f, top, size.width, bottom.coerceAtLeast(top + 1f)), CornerRadius(radius)))
}

internal fun LayoutCoordinates.rootRect(): Rect? {
    if (!isAttached) return null
    val a = localToRoot(Offset.Zero)
    val b = localToRoot(Offset(size.width.toFloat(), size.height.toFloat()))
    return Rect(minOf(a.x, b.x), minOf(a.y, b.y), maxOf(a.x, b.x), maxOf(a.y, b.y))
}

internal fun Rect.round(): IntRect = IntRect(left.roundToInt(), top.roundToInt(), right.roundToInt(), bottom.roundToInt())
