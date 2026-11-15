package ru.musixai.app.core.designsystem.content

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.compose.rememberAsyncImagePainter
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion

/**
 * «Сначала лёгкая, потом чёткая» (the owner, 2026-11-15: the player's cover came at 256 px): the
 * [light] picture at once (usually already in the cache — the list, the mini-player had it), the
 * [sharp] one faded in over it once decoded, never a blank in between. On a slow network one sees
 * the light one; nothing waits for the sharp one. Coil models: URLs, files, bitmaps.
 */
@Composable
fun ProgressiveImage(light: Any?, sharp: Any?, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    Box(modifier) {
        AsyncImage(light, null, Modifier.fillMaxSize(), contentScale = contentScale)
        if (sharp != null && sharp != light) SharpLayer(sharp, contentScale)
    }
}

@Composable
private fun SharpLayer(model: Any, contentScale: ContentScale) {
    val painter = rememberAsyncImagePainter(model)
    val state by painter.state.collectAsState()
    val reduced = rememberReducedMotion()
    val a by animateFloatAsState(if (state is AsyncImagePainter.State.Success) 1f else 0f, tween(if (reduced) 0 else 220), label = "sharp")
    // drawn even while invisible: the painter learns its size from the draw and only then loads
    Image(painter, null, Modifier.fillMaxSize().graphicsLayer { alpha = a }, contentScale = contentScale)
}
