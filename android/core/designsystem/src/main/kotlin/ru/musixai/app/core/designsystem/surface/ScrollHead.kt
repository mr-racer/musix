package ru.musixai.app.core.designsystem.surface

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.backdrops.LayerBackdrop
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.control.PlayPauseGlyph
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion

/** The height of the page's top row: the round button and the glass head beside it share it. */
val HeadHeight = 48.dp

/**
 * «Шапка по прокрутке» (revealOnScroll, spec §6 — the artist, the album; later the playlist and the
 * wall): once the page's picture has scrolled away, a capsule of matte glass ([GlassTone.Deep] —
 * it is read) slides in beside the back button, as tall as the button (48 dp, one line with it):
 * what the page is, and its main action. Under it a veil of the page's colour, so the page's words
 * never run under the status bar. [source] is the page's own picture (the shell's glass source is
 * cut off inside screens). Opacity and a short way in; nothing while hidden.
 */
@Composable
fun ScrollHead(
    shown: Boolean,
    source: LayerBackdrop?,
    modifier: Modifier = Modifier,
    veil: Color,
    content: @Composable RowScope.() -> Unit,
) {
    val reduced = rememberReducedMotion()
    val k by animateFloatAsState(if (shown) 1f else 0f, if (reduced) tween(0) else if (shown) spring(dampingRatio = 0.86f, stiffness = 420f) else tween(160), label = "head")
    Box(modifier.fillMaxWidth()) {
        // the veil: the page's colour under the status bar and the head, gone to nothing 64 dp lower
        Column(Modifier.fillMaxWidth().graphicsLayer { alpha = k }.drawBehind {
            drawRect(Brush.verticalGradient(0f to veil, 0.42f to veil, 0.7f to veil.copy(alpha = veil.alpha * 0.72f), 1f to Color.Transparent))
        }) {
            Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
            Spacer(Modifier.height(72.dp))
        }
        if (k > 0.001f) Row(
            Modifier.statusBarsPadding().padding(start = 8.dp + HeadHeight + 6.dp, end = 12.dp, top = 8.dp).fillMaxWidth().height(HeadHeight)
                .graphicsLayer { alpha = k; translationY = (1f - k) * -10.dp.toPx(); val s = 0.96f + 0.04f * k; scaleX = s; scaleY = s }
                .liquidGlass(RoundedCornerShape(999.dp), GlassTone.Deep, shadow = false, source = source)
                .padding(start = 6.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

/**
 * The head's play (the artist, the album): a soft disc of the glass's own ink, no accent — the owner,
 * 2026-11-15: the blue circle «вообще не вписывается» into the matte capsule. A hairline rim keeps it
 * a button on the light body; the ▶ flows into ❚❚.
 */
@Composable
fun HeadPlay(playing: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val reduced = rememberReducedMotion()
    val t by animateFloatAsState(if (playing) 1f else 0f, if (reduced) tween(0) else spring(dampingRatio = 0.82f, stiffness = 520f), label = "glyph")
    val ink = glassInk()
    Box(
        modifier.size(40.dp)
            .semantics { role = Role.Button; contentDescription = if (playing) "Пауза" else "Слушать" }
            .pressable(role = Press.Icon, haptic = HapticCue.Press, onClick = onClick)
            .clip(CircleShape).background(ink.copy(alpha = if (MusixTheme.isDark) 0.13f else 0.07f))
            .border(0.5.dp, ink.copy(alpha = if (MusixTheme.isDark) 0.16f else 0.12f), CircleShape),
        contentAlignment = Alignment.Center,
    ) { PlayPauseGlyph(t, Modifier.size(15.dp), ink) }
}

/**
 * The page's round back button at the head's height (48 dp — the owner, 2026-11-15: the head and
 * the button must be one size): see-through glass ([GlassTone.Chip]) — a key button, nothing read.
 */
@Composable
fun HeadButton(icon: ImageVector, description: String, onClick: () -> Unit, source: LayerBackdrop?, modifier: Modifier = Modifier, onArt: Boolean = true) {
    Box(
        modifier.statusBarsPadding().padding(start = 8.dp, top = 8.dp).size(HeadHeight)
            .pressable(role = Press.Icon, onClick = onClick)
            .liquidGlass(CircleShape, GlassTone.Chip, source = source, onArt = onArt),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, description, Modifier.size(22.dp), tint = glassInk(onArt)) }
}
