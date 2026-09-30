package ru.musixai.app.feature.library

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.oklch

/** The grid cover the user tapped, in root coordinates: the gatefold flies out of it and
 *  back into it (v1's shared-element FLIP). Set by the tile, read once by the album. */
object AlbumOrigin {
    @Volatile var rect: Rect? = null
    @Volatile var image: ru.musixai.app.core.model.Image? = null  // the tile's cover: the front paints at once
}

private val Fly = CubicBezierEasing(0.3f, 0.75f, 0.25f, 1f)          // 0.7 s to full screen
private val FlyBack = CubicBezierEasing(0.55f, 0.06f, 0.5f, 0.9f)    // 0.45 s back to the grid
private val FlipIn = CubicBezierEasing(0.35f, 0.72f, 0.22f, 1f)      // albumFlipIn 0.85 s (+60 ms)
private val Rise = CubicBezierEasing(0.22f, 0.9f, 0.3f, 1f)          // albumBackRise / albumRowIn

/**
 * v1's album «gatefold» on a phone: the tapped cover grows out of the grid to the whole
 * screen while the sleeve turns over; its back is the cover blurred into a dark field with
 * the title, the artist, «Играть всё» and the tracklist rising in (the rows one by one,
 * 35 ms apart). Back reverses it: the sleeve turns back and flies into its grid cover.
 */
@Composable
internal fun Gatefold(ui: AlbumUi, onPlay: (Int) -> Unit, onArtist: (() -> Unit)?, onClosed: () -> Unit) {
    val origin = remember { AlbumOrigin.rect.also { AlbumOrigin.rect = null } }
    val tileImage = remember { AlbumOrigin.image.also { AlbumOrigin.image = null } }
    val shown = if (ui.image != null) ui else ui.copy(image = tileImage)
    val fly = remember { Animatable(if (origin != null) 0f else 1f) }     // 0 = at the grid cover
    val turn = remember { Animatable(0f) }                                // 0 = front, 1 = back, 2 = front again
    val scope = rememberCoroutineScope()
    var closing by remember { mutableStateOf(false) }
    val rise = remember { Animatable(0f) }                                // ms since the open, for the rises
    LaunchedEffect(Unit) {
        coroutineScope {
            launch { fly.animateTo(1f, tween(700, easing = Fly)) }
            launch { delay(60); turn.animateTo(1f, tween(850, easing = FlipIn)) }
            launch { rise.animateTo(1600f, tween(1600, easing = androidx.compose.animation.core.LinearEasing)) }
        }
    }
    fun close(then: () -> Unit = onClosed) {
        if (closing) return
        closing = true
        scope.launch {
            coroutineScope {
                launch { turn.animateTo(2f, tween(500, easing = CubicBezierEasing(0.5f, 0.08f, 0.4f, 1f))) }
                if (origin != null) launch { fly.animateTo(0f, tween(450, easing = FlyBack)) }
            }
            then()
        }
    }
    BackHandler(!closing) { close() }

    BoxWithConstraints(Modifier.fillMaxSize().graphicsLayer { alpha = if (origin == null && closing) 1f - (turn.value - 1f).coerceIn(0f, 1f) else 1f }) {
        val density = LocalDensity.current
        val w = with(density) { maxWidth.toPx() }
        val h = with(density) { maxHeight.toPx() }
        // the overlay dims the library underneath as the sleeve leaves the grid
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.65f * fly.value)))
        Box(Modifier.fillMaxSize().graphicsLayer {
            val k = fly.value
            if (origin != null) {
                val sx = origin.width / w; val sy = origin.height / h
                scaleX = sx + (1f - sx) * k; scaleY = sy + (1f - sy) * k
                translationX = (origin.center.x - w / 2f) * (1f - k)
                translationY = (origin.center.y - h / 2f) * (1f - k)
            }
            val angle = 180f * turn.value
            rotationY = angle
            cameraDistance = 18f * density.density
        }) {
            val angle = (180f * turn.value) % 360f
            if (angle < 90f || angle > 270f) Front(shown) else Box(Modifier.fillMaxSize().graphicsLayer { rotationY = 180f }) {
                Back(shown, rise.value, onPlay = { i -> onPlay(i); close() }, onArtist = onArtist?.let { go -> { close(go) } }, onClose = { close() })
            }
        }
    }
}

@Composable
private fun Front(ui: AlbumUi) {
    Box(Modifier.fillMaxSize().background(Color(0xFF0D0A12))) {
        AsyncImage(ui.image?.url(1200), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        // the sleeve's sheen
        Box(Modifier.fillMaxSize().background(Brush.linearGradient(
            0f to Color(0x24FFFFFF), 0.32f to Color.Transparent, 0.68f to Color.Transparent, 1f to Color(0x47000000))))
    }
}

/** albumBackRise: opacity and 16 px of lift over 550 ms, from `delayMs` after the open. */
private fun riseAt(t: Float, delayMs: Float, ms: Float = 550f): Float = Rise.transform(((t - delayMs) / ms).coerceIn(0f, 1f))

@Composable
private fun Back(ui: AlbumUi, t: Float, onPlay: (Int) -> Unit, onArtist: (() -> Unit)?, onClose: () -> Unit) {
    val hue = ((((ui.title.firstOrNull()?.code ?: 65) * 37) + ((ui.artist?.firstOrNull()?.code ?: 65) * 17)) % 360).toFloat()
    Box(Modifier.fillMaxSize().background(Color(0xFF0D0A12))) {
        if (ui.image != null) {
            // v1 blurred the cover by 64 px; a tiny variant stretched to the screen is that same
            // soft field for a fraction of the cost, and a light blur smooths the stretch
            AsyncImage(ui.image.url(48), null, Modifier.fillMaxSize().graphicsLayer { scaleX = 1.24f; scaleY = 1.24f }
                .then(if (Build.VERSION.SDK_INT >= 31) Modifier.blur(12.dp) else Modifier), contentScale = ContentScale.Crop,
                colorFilter = androidx.compose.ui.graphics.ColorFilter.colorMatrix(androidx.compose.ui.graphics.ColorMatrix().apply { setToSaturation(1.35f) }))
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)))
        } else {
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(oklch(28f, 0.1f, hue), oklch(20f, 0.08f, (hue + 45) % 360)))))
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x520A0812), Color(0xA80A0812)))))
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val head = riseAt(t, 450f)
            Row(Modifier.graphicsLayer { alpha = head; translationY = 16.dp.toPx() * (1f - head) }, verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text("АЛЬБОМ", style = MusixTheme.type.body.copy(fontSize = 10.sp, letterSpacing = 0.24.em, color = Color(0x80EEEBF8)))
                    Text(ui.title, Modifier.padding(vertical = 6.dp), maxLines = 2, overflow = TextOverflow.Ellipsis,
                        style = MusixTheme.type.body.copy(fontFamily = MusixFontFamilies.Playfair, fontSize = 32.sp, lineHeight = 1.08.em,
                            letterSpacing = (-0.01).em, color = Color(0xFFF5F3FA),
                            shadow = androidx.compose.ui.graphics.Shadow(Color(0x80000000), blurRadius = 18f, offset = androidx.compose.ui.geometry.Offset(0f, 2f))))
                    ui.artist?.let { a ->
                        Text("$a →", Modifier.clip(RoundedCornerShape(999.dp)).background(Color(0x1FFFFFFF)).border(1.dp, Color(0x2EFFFFFF), RoundedCornerShape(999.dp))
                            .then(if (onArtist != null) Modifier.pressable(onClick = onArtist) else Modifier).padding(horizontal = 12.dp, vertical = 5.dp),
                            style = MusixTheme.type.body.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Color(0xFFEDE8FF)))
                    }
                    val total = ui.tracks.sumOf { it.durationMs }
                    Text(listOfNotNull(ui.year?.toString() ?: "—", "${ui.tracks.size} ${tracksWord(ui.tracks.size)}", fmtDur(total)).joinToString("   ·   "),
                        Modifier.padding(top = 10.dp), style = MusixTheme.type.body.copy(fontSize = 12.5.sp, letterSpacing = 0.04.em, color = Color(0x99EEEBF8)))
                }
                Text("✕", Modifier.size(34.dp).clip(CircleShape).background(Color(0x0FFFFFFF)).pressable(onClick = onClose).padding(top = 6.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center, style = MusixTheme.type.body.copy(fontSize = 15.sp, color = Color(0xB3EEEBF8)))
            }
            val act = riseAt(t, 550f)
            Text("▶  Играть всё", Modifier.graphicsLayer { alpha = act; translationY = 16.dp.toPx() * (1f - act) }
                .dropShadow(RoundedCornerShape(10.dp), Shadow(radius = 18.dp, color = Color(0x597C5BFF), offset = DpOffset(0.dp, 6.dp)))
                .clip(RoundedCornerShape(10.dp)).background(Brush.verticalGradient(listOf(oklch(62f, 0.21f, 272f), oklch(49f, 0.22f, 283f))))
                .pressable { onPlay(0) }.padding(horizontal = 18.dp, vertical = 9.dp),
                style = MusixTheme.type.body.copy(fontSize = 12.sp, letterSpacing = 0.06.em, color = Color.White))
            LazyColumn(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(14.dp)).background(Color(0xB808060E))
                .border(1.dp, Color(0x14FFFFFF), RoundedCornerShape(14.dp))) {
                itemsIndexed(ui.tracks) { i, tr ->
                    val k = Rise.transform(((t - 620f - 35f * i.coerceAtMost(20)) / 400f).coerceIn(0f, 1f))
                    Row(Modifier.fillMaxWidth().graphicsLayer { alpha = k; translationX = -10.dp.toPx() * (1f - k) }
                        .pressable { onPlay(i) }.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}", Modifier.width(28.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            style = MusixTheme.type.body.copy(fontSize = 11.sp, color = Color(0x66EEEBF8)))
                        Text(tr.title, Modifier.weight(1f).padding(horizontal = 10.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MusixTheme.type.body.copy(fontSize = 13.sp, color = Color(0xFFECE9F4)))
                        Text(fmtDur(tr.durationMs), style = MusixTheme.type.body.copy(fontSize = 11.sp, color = Color(0x66EEEBF8)))
                    }
                    if (i < ui.tracks.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0x0FFFFFFF)))
                }
            }
        }
    }
}

private fun tracksWord(n: Int): String {
    val d10 = n % 10; val d100 = n % 100
    return if (d10 == 1 && d100 != 11) "трек" else if (d10 in 2..4 && d100 !in 12..14) "трека" else "треков"
}
