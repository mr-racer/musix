package ru.musixai.app.core.designsystem.control

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.backdrops.LayerBackdrop
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.glassInk
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.text

/**
 * «Стеклянный плей» — a page's main play: see-through glass ([GlassTone.Chip]) with a ▶ that flows
 * into ❚❚. No accent fill — the owner, 2026-11-15: the blue button «вообще не вписывается» into a
 * page made of a picture and glass; key buttons are clear glass, surfaces one reads from are matte.
 *
 * Round by default (over the artist's photo). With a [label] it is a capsule [size] tall with the
 * word beside the glyph (the album's leaf: «Слушать» / «Пауза»). [onArt] keeps the glass dark in
 * both themes — over a photo; on a sheet of the page's own colours it follows the theme.
 *
 * [source] is the picture under the button, recorded by `glassSource` on a sibling: the button must
 * not be part of it (glass that reads itself).
 */
@Composable
fun GlassPlayButton(
    playing: Boolean,
    onClick: () -> Unit,
    source: LayerBackdrop?,
    modifier: Modifier = Modifier,
    size: Dp = 56.dp,
    label: String? = null,
    onArt: Boolean = true,
    shadow: Boolean = false,
) {
    val reduced = rememberReducedMotion()
    val t by animateFloatAsState(if (playing) 1f else 0f, if (reduced) tween(0) else spring(dampingRatio = 0.82f, stiffness = 520f), label = "glyph")
    val ink = glassInk(onArt)
    if (label == null) {
        Box(
            modifier.size(size)
                .semantics { role = Role.Button; contentDescription = if (playing) "Пауза" else "Слушать" }
                .pressable(role = Press.Icon, haptic = HapticCue.Press, onClick = onClick)
                .liquidGlass(CircleShape, GlassTone.Chip, shadow = shadow, source = source, onArt = onArt),
            contentAlignment = Alignment.Center,
        ) {
            // the glyph's ▶ already sits right of its box (0.22–0.92 of the width): optically centred as is
            PlayPauseGlyph(t, Modifier.size(size * 0.38f), ink)
        }
    } else {
        Row(
            modifier.height(size)
                .semantics { role = Role.Button }
                .pressable(role = Press.Chip, haptic = HapticCue.Press, onClick = onClick)
                .liquidGlass(RoundedCornerShape(size / 2), GlassTone.Chip, shadow = shadow, source = source, onArt = onArt)
                .padding(start = 16.dp, end = 20.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PlayPauseGlyph(t, Modifier.size(17.dp), ink)
            Text(label, Modifier.padding(start = 8.dp), maxLines = 1, style = MusixTheme.text.label.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = ink))
        }
    }
}
