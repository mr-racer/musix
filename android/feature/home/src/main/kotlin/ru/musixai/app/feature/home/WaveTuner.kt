package ru.musixai.app.feature.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateRectAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInParent
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.LiquidGlass
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.model.WavePreset
import kotlin.math.roundToInt

/** The labels before the presets load (the server's, as of 2026-11-13). */
private val LABELS = mapOf(
    "mix" to "Микс", "favorites" to "Любимое", "rediscover" to "Давно не слушал", "unfamiliar" to "Незнакомое",
    "calm" to "Спокойное", "energetic" to "Бодрое",
)
private val MOOD = mapOf("calm" to "◐", "energetic" to "☀")

private fun Tune.label(id: String) = presets?.firstOrNull { it.id == id }?.label ?: LABELS[id] ?: id

/** r3 §5.3: «Моя волна» as a glass capsule — mood glyph · what · mood · chevron; 40 high,
 *  48 to touch. It opens the tuner through [MorphMenu]; offline it is dimmed and inert. */
@Composable
internal fun WaveCapsule(tune: Tune, enabled: Boolean, hidden: Boolean, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.heightIn(min = 48.dp).graphicsLayer { alpha = if (hidden) 0f else if (enabled) 1f else 0.45f }
        .pressable(enabled = enabled, onClick = onOpen)
        .semantics { role = Role.Button; contentDescription = "Моя волна: ${capsuleText(tune)}. Настроить" },
        contentAlignment = Alignment.Center) {
        LiquidGlass(Modifier.height(40.dp), radius = 20.dp) { CapsuleFace(tune) }
    }
}

private fun capsuleText(t: Tune) = listOfNotNull(t.label(t.familiarity), t.sound?.let { t.label(it) }).joinToString(" · ")

/** The capsule's contents: drawn in the capsule and as the morph's fading face. */
@Composable
internal fun CapsuleFace(tune: Tune, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    Row(modifier.height(40.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        tune.sound?.let { MOOD[it] }?.let { Text(it, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.accentLight)) }
        Text(capsuleText(tune), maxLines = 1, style = MusixTheme.type.body.copy(fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = c.text))
        Icon(MusixIcons.ChevronDown, null, Modifier.size(12.dp), tint = c.textMuted)
    }
}

/** The panel the capsule flows into: «Что играть» as four segments on a fluid highlight
 *  (2 × 2 when four do not fit), «Настроение» as two toggles; every tap saves at once. */
@Composable
internal fun TunerPanel(tune: Tune, onPick: (WavePreset) -> Unit, onReset: () -> Unit, onClose: () -> Unit) {
    val c = MusixTheme.colors
    val list = tune.presets
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 14.dp)) {
        Row(Modifier.height(44.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Моя волна", Modifier.weight(1f), style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text))
            val custom = tune.familiarity != "mix" || tune.sound != null
            if (custom && !list.isNullOrEmpty()) Text("Сбросить", Modifier.clip(RoundedCornerShape(999.dp)).pressable(onClick = onReset)
                .padding(horizontal = 10.dp, vertical = 12.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            Box(Modifier.size(44.dp).pressable(onClick = onClose).semantics { contentDescription = "Свернуть" }, contentAlignment = Alignment.Center) {
                Icon(MusixIcons.ChevronDown, null, Modifier.size(14.dp).rotate(180f), tint = c.textMuted)
            }
        }
        Column(Modifier.padding(end = 8.dp)) {
            when {
                list == null -> Text("Загружаю…", Modifier.padding(vertical = 12.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
                list.isEmpty() -> Text(tune.error ?: "Настроек пока нет", Modifier.padding(vertical = 12.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
                else -> {
                    val what = list.filter { it.row == "familiarity" }
                    val mood = list.filter { it.row == "sound" }
                    if (what.isNotEmpty()) {
                        Caption("Что играть")
                        Segments(what, tune.familiarity, onPick)
                    }
                    if (mood.isNotEmpty()) {
                        Caption("Настроение", Modifier.padding(top = 14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (m in mood) Toggle(m, tune.sound == m.id, Modifier.weight(1f)) { onPick(m) }
                        }
                    }
                }
            }
            AnimatedContent(tune.error ?: if (tune.saved) "Сохранено ✓" else "", label = "status") { t ->
                Text(t, Modifier.padding(top = if (t.isEmpty()) 0.dp else 10.dp),
                    style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = if (tune.error != null) c.red else c.textSubtle))
            }
        }
    }
}

@Composable
private fun Caption(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(bottom = 8.dp), style = MusixTheme.type.body.copy(fontSize = 12.sp, color = MusixTheme.colors.textSubtle))
}

/** Four segments; the lit one's highlight flows between them on a spring. */
@Composable
private fun Segments(items: List<WavePreset>, value: String, onPick: (WavePreset) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val bounds = remember { mutableStateMapOf<String, Rect>() }
    val measurer = rememberTextMeasurer()
    val widest = MusixTheme.type.body.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    BoxWithConstraints(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (dark) Color(0x12FFFFFF) else Color(0x0D000000)).padding(4.dp)) {
        // a row only when every word of every label fits its segment (gaps 3 × 4, label
        // padding 2 × 6); a word broken across lines («Незнакомо / е») is worse than 2 × 2
        val seg = with(LocalDensity.current) { ((maxWidth - 12.dp) / items.size.coerceAtLeast(1) - 12.dp).roundToPx() }
        val grid = remember(seg, items, widest) {
            items.any { p -> p.label.split(' ').any { w -> measurer.measure(w, widest).size.width > seg } }
        }
        val lit = bounds[value]
        if (lit != null) {
            val r by animateRectAsState(lit, spring(dampingRatio = 0.8f, stiffness = 420f), label = "lit")
            val d = LocalDensity.current
            Box(Modifier.offset { IntOffset(r.left.roundToInt(), r.top.roundToInt()) }
                .size(with(d) { r.width.toDp() }, with(d) { r.height.toDp() })
                .clip(RoundedCornerShape(12.dp)).background(c.accent.copy(alpha = if (dark) 0.30f else 0.18f)))
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (row in if (grid) items.chunked(2) else listOf(items)) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (it in row) {
                    val on = it.id == value
                    val col by animateColorAsState(if (on) c.text else c.textMuted, tween(200), label = "seg")
                    Box(Modifier.weight(1f).heightIn(min = 48.dp).onGloballyPositioned { lc -> bounds[it.id] = lc.boundsInParent().let { b -> rowOffset(b, lc) } }
                        .pressable { onPick(it) }.semantics { selected = on; role = Role.Tab }, contentAlignment = Alignment.Center) {
                        Text(it.label, textAlign = TextAlign.Center, maxLines = 2,
                            style = MusixTheme.type.body.copy(fontSize = 13.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium, color = col),
                            modifier = Modifier.padding(horizontal = 6.dp))
                    }
                }
                if (grid && row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** A segment's bounds in the tray: its row's offset plus its own within the row. */
private fun rowOffset(inRow: Rect, lc: androidx.compose.ui.layout.LayoutCoordinates): Rect {
    val row = lc.parentLayoutCoordinates?.boundsInParent() ?: return inRow
    return inRow.translate(row.left, row.top)
}

@Composable
private fun Toggle(p: WavePreset, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val shape = RoundedCornerShape(14.dp)
    val bg by animateColorAsState(if (on) c.accent.copy(alpha = if (dark) 0.30f else 0.18f) else if (dark) Color(0x12FFFFFF) else Color(0x0D000000), tween(200), label = "bg")
    val edge by animateColorAsState(if (on) c.accentLight.copy(alpha = 0.6f) else Color.Transparent, tween(200), label = "edge")
    Row(modifier.heightIn(min = 48.dp).clip(shape).background(bg).border(1.dp, edge, shape).pressable(onClick = onClick)
        .semantics { selected = on; role = Role.Switch }.padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        MOOD[p.id]?.let { Text(it, style = MusixTheme.type.body.copy(fontSize = 14.sp, color = if (on) c.accentLight else c.textMuted)); Spacer(Modifier.width(8.dp)) }
        Text(p.label, maxLines = 1, style = MusixTheme.type.body.copy(fontSize = 13.5.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium, color = c.text))
    }
}
