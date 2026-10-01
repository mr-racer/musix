package ru.musixai.app.core.designsystem.component

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.Image as CoverImage
import kotlin.math.roundToInt

/**
 * v1 `AlbumCover`: the server's variant nearest the drawn size, a blurhash while it loads,
 * and — with no cover or on error — v1's deterministic gradient from title/artist with two
 * initials. The bevel (lit top edge, dark rim, drop shadow) is v1's box-shadow stack.
 */
@Composable
fun Cover(
    image: CoverImage?,
    title: String,
    artist: String,
    modifier: Modifier = Modifier,
    size: Dp? = 44.dp,
    radius: Dp? = null,
    shadow: Boolean = true,
) {
    val dark = MusixTheme.isDark
    val br = radius ?: when { size == null -> 14.dp; size > 100.dp -> 14.dp; size > 60.dp -> 10.dp; else -> 8.dp }
    val shape = RoundedCornerShape(br)
    val px = with(LocalDensity.current) { ((size ?: 320.dp).toPx()).roundToInt() }
    val box = (if (size != null) modifier.size(size) else modifier.fillMaxWidth().aspectRatio(1f))
        .then(if (shadow) Modifier.dropShadow(shape, Shadow(radius = 8.dp, color = if (dark) Color(0x8C000000) else Color(0x21281E3C), offset = DpOffset(0.dp, 3.dp))) else Modifier)
        .clip(shape)
    Box(box) {
        val url = image?.url(px)
        if (url == null) {
            Fallback(title, artist, size)
        } else {
            SubcomposeAsyncImage(
                model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
                loading = { image.blurhash?.let { Blurhash(it) } ?: Fallback(title, artist, size) },
                error = { Fallback(title, artist, size) },
            )
        }
        Box(Modifier.fillMaxSize()
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x24FFFFFF) else Color(0xD9FFFFFF), offset = DpOffset(0.dp, 1.dp)))
            .innerShadow(shape, Shadow(radius = 0.dp, spread = 1.dp, color = if (dark) Color(0x80000000) else Color(0x14000000))))
    }
}

@Composable
private fun Fallback(title: String, artist: String, size: Dp?) {
    val hue = (((title.firstOrNull()?.code ?: 65) * 37 + (artist.firstOrNull()?.code ?: 65) * 17) % 360).toFloat()
    Box(
        Modifier.fillMaxSize().background(Brush.linearGradient(listOf(oklch(38f, 0.13f, hue), oklch(52f, 0.18f, (hue + 45) % 360)))),
        contentAlignment = Alignment.Center,
    ) {
        Text(title.ifEmpty { "?" }.take(2).uppercase(), style = MusixTheme.type.label.copy(
            fontSize = if ((size ?: 200.dp) > 60.dp) 22.sp else 12.sp, fontWeight = FontWeight.Bold, color = Color(0xA6FFFFFF), letterSpacing = 0.5.sp))
    }
}

private val blurhashes = android.util.LruCache<String, Bitmap>(256)

/** The placeholder decode runs off the main thread (a grid scroll shows dozens at once). */
@Composable
fun Blurhash(hash: String) {
    val bmp by androidx.compose.runtime.produceState(blurhashes.get(hash), hash) {
        if (value == null) value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            BlurHash.decode(hash, 24, 24)?.also { blurhashes.put(hash, it) }
        }
    }
    bmp?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
}

/** v1 `MosaicCover`: the first 1–4 track covers of a playlist; three = the first full width. */
@Composable
fun MosaicCover(images: List<CoverImage?>, modifier: Modifier = Modifier, size: Dp? = 160.dp, radius: Dp = 12.dp) {
    val shape = RoundedCornerShape(radius)
    val n = images.size.coerceAtMost(4)
    val box = (if (size != null) modifier.size(size) else modifier.fillMaxWidth().aspectRatio(1f)).clip(shape)
    if (n == 0) {
        Box(box.background(Brush.linearGradient(listOf(Color(0x387C5BFF), Color(0x24FF78C8)))), contentAlignment = Alignment.Center) {
            Text("♫", style = MusixTheme.type.body.copy(fontSize = ((size ?: 160.dp).value * 0.34f).sp, color = Color(0x73FFFFFF)))
        }
        return
    }
    androidx.compose.foundation.layout.Column(box.background(Color(0x66000000)), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(1.dp)) {
        val rows: List<List<CoverImage?>> = when (n) { 1 -> listOf(images.take(1)); 2 -> listOf(images.take(2)); 3 -> listOf(images.take(1), images.subList(1, 3)); else -> listOf(images.take(2), images.subList(2, 4)) }
        for (row in rows) {
            androidx.compose.foundation.layout.Row(Modifier.weight(1f), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(1.dp)) {
                for (img in row) Cover(img, "", "", Modifier.weight(1f).fillMaxSize(), size = null, radius = 0.dp, shadow = false)
            }
        }
    }
}
