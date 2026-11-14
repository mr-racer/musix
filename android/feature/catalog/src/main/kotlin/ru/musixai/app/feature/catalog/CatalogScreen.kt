package ru.musixai.app.feature.catalog

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Handler
import android.os.Looper
import android.view.Window
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.bleed
import ru.musixai.app.core.designsystem.control.Pill
import ru.musixai.app.core.designsystem.control.PillStyle
import ru.musixai.app.core.designsystem.control.RoundButton
import ru.musixai.app.core.designsystem.control.Segments
import ru.musixai.app.core.designsystem.gesture.ProvideMusixHaptics
import ru.musixai.app.core.designsystem.motion.LocalReducedMotionOverride
import ru.musixai.app.core.designsystem.motion.cascade
import ru.musixai.app.core.designsystem.motion.rememberEntry
import ru.musixai.app.core.designsystem.plate
import ru.musixai.app.core.designsystem.surface.LocalSheetHost
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.surface.SheetHost
import ru.musixai.app.core.designsystem.surface.ToastHost
import ru.musixai.app.core.designsystem.surface.rememberToasts
import ru.musixai.app.core.designsystem.text
import java.util.concurrent.atomic.AtomicInteger

/**
 * «Витрина» (2026-11-14 spec §5.5): every component of the library on a card of its own — a
 * live demo on demo data, who takes it, what it says to the hand, what it costs. Above, the
 * switches that test it the way the owner will: the other theme, motion off, vibration off;
 * and a meter of the frames the window really draws — at rest it reads «в покое».
 * Opened from Settings (seven taps on the version) or `musix://catalog`.
 */
@Composable
fun CatalogRoute(onBack: () -> Unit) {
    val system = MusixTheme.isDark
    var dark by rememberSaveable { mutableStateOf(system) }
    var still by rememberSaveable { mutableStateOf(false) }
    var vibe by rememberSaveable { mutableStateOf(true) }
    MusixTheme(dark = dark) {
        CompositionLocalProvider(LocalReducedMotionOverride provides (if (still) true else null)) {
            ProvideMusixHaptics(enabled = vibe) {
                Hosts {
                    Catalog(onBack, dark, { dark = it }, still, { still = it }, vibe, { vibe = it })
                }
            }
        }
    }
}

/**
 * Sheets come from the shell's host (they take the caller's theme with them); toasts — plain
 * text the shell would draw in the app's theme — get a stack of the catalog's own, so they
 * follow its theme switch. Reached without a shell (tests), the catalog brings a sheet host too.
 */
@Composable
private fun Hosts(content: @Composable () -> Unit) {
    val toasts = rememberToasts()
    val body: @Composable () -> Unit = {
        CompositionLocalProvider(LocalToasts provides toasts) {
            Box(Modifier.fillMaxSize()) { content(); ToastHost(toasts, Modifier.align(Alignment.BottomCenter)) }
        }
    }
    if (LocalSheetHost.current != null) body() else SheetHost { body() }
}

@Composable
private fun Catalog(
    onBack: () -> Unit,
    dark: Boolean, onDark: (Boolean) -> Unit,
    still: Boolean, onStill: (Boolean) -> Unit,
    vibe: Boolean, onVibe: (Boolean) -> Unit,
) {
    val c = MusixTheme.colors
    var screen by rememberSaveable { mutableStateOf<Screen?>(null) }
    val shown = remember(screen) { CATALOG.filter { screen == null || screen in it.users } }
    val entry = rememberEntry(screen)
    val fps by rememberFrameRate()
    Box(Modifier.fillMaxSize().background(c.bg)) {
    LazyColumn(
        Modifier.fillMaxSize().testTag("catalog"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "head") {
            Column(Modifier.statusBarsPadding().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RoundButton(MusixIcons.ChevronLeft, "Назад", onBack)
                    Column(Modifier.weight(1f).padding(start = 6.dp)) {
                        Text("Витрина", style = MusixTheme.text.title.copy(color = c.text))
                        Text("${CATALOG.size} компонентов · ${Layer.entries.size} слоёв", style = MusixTheme.text.caption.copy(color = c.textMuted))
                    }
                    Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (fps == 0) c.surface2 else c.accent.copy(alpha = 0.18f)).padding(horizontal = 12.dp, vertical = 6.dp)) {
                        Text(if (fps == 0) "в покое" else "$fps к/с", style = MusixTheme.text.number.copy(color = if (fps == 0) c.textMuted else c.accentLight))
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill(if (dark) "Тёмная" else "Светлая", onClick = { onDark(!dark) })
                    Pill("Без анимаций", onClick = { onStill(!still) }, style = if (still) PillStyle.Accent else PillStyle.Outline)
                    Pill("Вибрация", onClick = { onVibe(!vibe) }, style = if (vibe) PillStyle.Accent else PillStyle.Outline)
                }
                // who takes what: the filter by screen of the migration plan
                Row(Modifier.bleed(16.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("Все", onClick = { screen = null }, style = if (screen == null) PillStyle.Accent else PillStyle.Soft)
                    Screen.entries.forEach { s ->
                        Pill(s.title, onClick = { screen = s }, style = if (screen == s) PillStyle.Accent else PillStyle.Soft)
                    }
                }
            }
        }
        Layer.entries.forEach { layer ->
            val inLayer = shown.filter { it.layer == layer }
            if (inLayer.isEmpty()) return@forEach
            item(key = "layer-${layer.name}") {
                Column(Modifier.padding(top = 14.dp)) {
                    Text(layer.title, style = MusixTheme.text.heading.copy(color = c.text))
                    Text(layer.rule, style = MusixTheme.text.caption.copy(color = c.textMuted))
                }
            }
            itemsIndexed(inLayer, key = { _, e -> e.id }) { i, e -> EntryCard(e, Modifier.cascade(i, entry)) }
        }
    }
    Box(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(c.bg))  // opaque: text under the clock reads as noise
    }
}

@Composable
private fun EntryCard(e: CatalogEntry, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    var state by rememberSaveable(e.id) { mutableStateOf(e.states.firstOrNull() ?: "") }
    Column(modifier.fillMaxWidth().plate(20.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(e.name, Modifier.weight(1f), style = MusixTheme.text.lead.copy(color = c.text))
            Text(e.id, style = MusixTheme.text.number.copy(color = c.textSubtle))
        }
        Text(e.what, style = MusixTheme.text.caption.copy(color = c.textMuted))
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Meta("Берут", if (e.users.size == Screen.entries.size) "все экраны" else e.users.joinToString(" · ") { it.title })
            if (e.haptic != null) Meta("Вибрация", e.haptic)
            Meta("Цена", e.cost)
        }
        if (e.states.isNotEmpty()) Segments(state, e.states.map { it to it }, { state = it })
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.bgDeep).padding(14.dp)) { e.demo(state) }
    }
}

@Composable
private fun Meta(label: String, value: String) {
    val c = MusixTheme.colors
    Row {
        Text("$label  ", style = MusixTheme.text.caption.copy(color = c.textSubtle))
        Text(value, style = MusixTheme.text.caption.copy(color = c.text))
    }
}

/**
 * Frames the window actually drew in the last second (FrameMetrics, API 24+) — without asking
 * for a single frame itself. Changing its own label costs about two frames: the second after a
 * change has those taken off, or the meter would keep itself awake (it did: 0 → 2 → 2 → 0 …).
 */
@Composable
private fun rememberFrameRate(): State<Int> {
    val view = LocalView.current
    val rate = remember { mutableIntStateOf(0) }
    val count = remember { AtomicInteger() }
    DisposableEffect(view) {
        val window: Window? = view.context.findActivity()?.window
        val listener = Window.OnFrameMetricsAvailableListener { _, _, _ -> count.incrementAndGet() }
        window?.addOnFrameMetricsAvailableListener(listener, Handler(Looper.getMainLooper()))
        onDispose { window?.removeOnFrameMetricsAvailableListener(listener) }
    }
    LaunchedEffect(Unit) {
        var own = false  // the label changed a second ago: its redraw is in this count
        while (true) {
            delay(1_000)
            var n = count.getAndSet(0)
            if (own) n = (n - 3).coerceAtLeast(0)
            own = n != rate.intValue
            if (own) rate.intValue = n
        }
    }
    return rate
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
