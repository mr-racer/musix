package ru.musixai.app.feature.catalog

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.boundsInParent
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.Cover
import ru.musixai.app.core.designsystem.content.Empty
import ru.musixai.app.core.designsystem.content.Markdown
import ru.musixai.app.core.designsystem.content.MosaicCover
import ru.musixai.app.core.designsystem.content.ScreenState
import ru.musixai.app.core.designsystem.content.Skel
import ru.musixai.app.core.designsystem.content.Spinner
import ru.musixai.app.core.designsystem.content.StateHost
import ru.musixai.app.core.designsystem.control.Glyph
import ru.musixai.app.core.designsystem.control.GlassField
import ru.musixai.app.core.designsystem.control.MorphIcon
import ru.musixai.app.core.designsystem.control.Pill
import ru.musixai.app.core.designsystem.control.PillStyle
import ru.musixai.app.core.designsystem.control.PlayPauseGlyph
import ru.musixai.app.core.designsystem.control.RoundButton
import ru.musixai.app.core.designsystem.control.SearchField
import ru.musixai.app.core.designsystem.control.Segments
import ru.musixai.app.core.designsystem.control.Tabs
import ru.musixai.app.core.designsystem.control.TextLink
import ru.musixai.app.core.designsystem.float
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.gesture.rememberDebounced
import ru.musixai.app.core.designsystem.gesture.rubberBand
import ru.musixai.app.core.designsystem.motion.MusixSprings
import ru.musixai.app.core.designsystem.motion.PageDirection
import ru.musixai.app.core.designsystem.motion.Reveal
import ru.musixai.app.core.designsystem.motion.RevealStyle
import ru.musixai.app.core.designsystem.motion.Swap
import ru.musixai.app.core.designsystem.motion.cascade
import ru.musixai.app.core.designsystem.motion.pageFocusBlur
import ru.musixai.app.core.designsystem.motion.popIn
import ru.musixai.app.core.designsystem.motion.rememberEntry
import ru.musixai.app.core.designsystem.motion.rememberPageFocus
import ru.musixai.app.core.designsystem.motion.rememberParkingLoop
import ru.musixai.app.core.designsystem.plate
import ru.musixai.app.core.designsystem.surface.GlassScene
import ru.musixai.app.core.designsystem.surface.LiquidGlass
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.surface.MorphMenu
import ru.musixai.app.core.designsystem.surface.Sheet
import ru.musixai.app.core.designsystem.surface.rememberMorph
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text
import kotlin.math.abs
import kotlin.math.sign

// Demo data: made-up albums with no images — the covers draw their own gradients.
private val ALBUMS = listOf(
    "Ночной трамвай" to "Северные огни", "Тёплый шум" to "Озеро", "Медленные дни" to "Кассета",
    "Город спит" to "Полоса", "Сухой лёд" to "Неон", "Прибой" to "Маяк",
)

@Composable
private fun Note(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier, style = MusixTheme.text.caption.copy(color = MusixTheme.colors.textMuted))

@Composable
internal fun TextDemo() {
    val t = MusixTheme.text
    val c = MusixTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("ЗАГОЛОВОК ЭКРАНА · CAP", style = t.cap.copy(color = c.textMuted))
        Text("Тёплый шум", style = t.title.copy(color = c.text))
        Text("Раздел · heading", style = t.heading.copy(color = c.text))
        Text("Строка, карточка · lead", style = t.lead.copy(color = c.text))
        Text("Тело интерфейса · body", style = t.body.copy(color = c.text))
        Text("То, что читают: ответы ассистента, факты о треке, биографии · reading", style = t.reading.copy(color = c.text))
        Text("Кнопки и пилюли · label", style = t.label.copy(color = c.text))
        Text("Вторичная строка · caption", style = t.caption.copy(color = c.textMuted))
        Text("3:41 · 128 треков · 24-bit", style = t.number.copy(color = c.textMuted))
    }
}

@Composable
internal fun SurfacesDemo() {
    val c = MusixTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.weight(1f).height(96.dp).float(RoundedCornerShape(20.dp)).padding(14.dp)) {
            Text("float", style = MusixTheme.text.label.copy(color = c.text))
        }
        Box(Modifier.weight(1f).height(96.dp).plate().padding(14.dp)) {
            Text("plate", style = MusixTheme.text.label.copy(color = c.text))
        }
    }
}

@Composable
internal fun SpringsDemo() {
    var on by remember { mutableStateOf(false) }
    val c = MusixTheme.colors
    val rows = listOf("меню" to MusixSprings.menu<Float>(), "страница" to MusixSprings.page<Float>(),
        "поп" to MusixSprings.pop<Float>(), "оседание" to MusixSprings.settle<Float>())
    Column(Modifier.fillMaxWidth().pressable(role = Press.Card) { on = !on }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { (name, spec) ->
            val t = animateFloatAsState(if (on) 1f else 0f, spec, label = name)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(name, Modifier.width(78.dp), style = MusixTheme.text.caption.copy(color = c.textMuted))
                BoxWithConstraints(Modifier.weight(1f).height(18.dp)) {
                    val run = constraints.maxWidth - with(LocalDensity.current) { 18.dp.toPx() }
                    Box(Modifier.fillMaxWidth().height(2.dp).align(Alignment.Center).background(c.border))
                    Box(Modifier.size(18.dp).graphicsLayer { translationX = t.value * run }.background(c.accent, CircleShape))
                }
            }
        }
        Note("Нажмите на карточку — и ещё раз, не дожидаясь конца: пружина подхватит скорость.")
    }
}

@Composable
internal fun RevealDemo(state: String) {
    var shown by remember { mutableStateOf(true) }
    val style = when (state) { "Складка" -> RevealStyle.Fold; "Схлоп" -> RevealStyle.Collapse; "Растворение" -> RevealStyle.Fade; else -> RevealStyle.Rise }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Pill(if (shown) "Скрыть" else "Показать", onClick = { shown = !shown })
        Box(Modifier.fillMaxWidth().height(84.dp)) {
            Reveal(shown, style = style) {
                Row(Modifier.fillMaxWidth().plate().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Cover(null, ALBUMS[0].first, ALBUMS[0].second, size = 48.dp)
                    Column {
                        Text(ALBUMS[0].first, style = MusixTheme.text.lead.copy(color = MusixTheme.colors.text))
                        Note(ALBUMS[0].second)
                    }
                }
            }
        }
    }
}

@Composable
internal fun SwapDemo() {
    var n by remember { mutableIntStateOf(128) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Swap(n) { Text("$it треков", style = MusixTheme.text.lead.copy(color = MusixTheme.colors.text)) }
        Pill("+1", onClick = { n++ })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CascadeDemo() {
    var run by remember { mutableIntStateOf(0) }
    val entry = rememberEntry(run)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 3) {
            ALBUMS.forEachIndexed { i, (title, artist) ->
                // keyed on the run: a new run is a new entrance
                androidx.compose.runtime.key(run, i) { Cover(null, title, artist, Modifier.cascade(i, entry), size = 84.dp) }
            }
        }
        Pill("Ещё раз", onClick = { run++ })
    }
}

@Composable
internal fun PopDemo() {
    var liked by remember { mutableStateOf(false) }
    val c = MusixTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(48.dp).pressable(role = Press.Icon, haptic = if (liked) HapticCue.ToggleOff else HapticCue.ToggleOn) { liked = !liked }, contentAlignment = Alignment.Center) {
            Icon(MusixIcons.Star, "Нравится", Modifier.size(26.dp).popIn(liked), tint = if (liked) c.amber else c.textMuted)
        }
        Note(if (liked) "В избранном" else "Нажмите звезду")
    }
}

/** A ball on a spring the finger can pull: the loop runs while it moves, then parks. */
private class Ball { var x = 0f; var y = 0f; var vx = 0f; var vy = 0f; var held = false
    fun step(dt: Float): Boolean {
        if (held) return false
        val k = 140f; val d = 11f
        val h = dt.coerceAtMost(1f / 30f)
        vx += (-k * x - d * vx) * h; vy += (-k * y - d * vy) * h
        x += vx * h; y += vy * h
        val moving = abs(x) > 0.3f || abs(y) > 0.3f || abs(vx) > 3f || abs(vy) > 3f
        if (!moving) { x = 0f; y = 0f; vx = 0f; vy = 0f }
        return moving
    }
}

@Composable
internal fun ParkingDemo() {
    val ball = remember { Ball() }
    val loop = rememberParkingLoop { ball.step(it) }
    val c = MusixTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // only the ball takes the finger: a swipe beside it still scrolls the page
        Box(Modifier.fillMaxWidth().height(150.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.size(44.dp).graphicsLayer { loop.frame; translationX = ball.x; translationY = ball.y }
                .pointerInput(Unit) {
                    val tracker = VelocityTracker()
                    detectDragGestures(
                        onDragStart = { ball.held = true; tracker.resetTracking() },
                        onDragEnd = { val v = tracker.calculateVelocity(); ball.vx = v.x; ball.vy = v.y; ball.held = false; loop.wake() },
                        onDragCancel = { ball.held = false; loop.wake() },
                    ) { change, d -> ball.x += d.x; ball.y += d.y; tracker.addPosition(change.uptimeMillis, Offset(ball.x, ball.y)); loop.wake() }
                }
                .background(c.accent, CircleShape))
        }
        Text("кадров с начала: ${loop.frame}", style = MusixTheme.text.number.copy(color = c.textMuted))
    }
}

@Composable
internal fun PageFocusDemo() {
    var page by remember { mutableIntStateOf(0) }
    val forward = rememberPageFocus(PageDirection.Forward)
    val back = rememberPageFocus(PageDirection.Back)
    val pages = listOf("Библиотека", "Альбом", "Трек")
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        AnimatedContent(page, transitionSpec = {
            val f = if (targetState > initialState) forward else back
            f.enter togetherWith f.exit
        }, label = "pages") { p ->
            Row(Modifier.fillMaxWidth().pageFocusBlur(this).plate().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Cover(null, ALBUMS[p + 1].first, ALBUMS[p + 1].second, size = 56.dp)
                Column {
                    Text(pages[p], style = MusixTheme.text.lead.copy(color = MusixTheme.colors.text))
                    Note(ALBUMS[p + 1].first)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Pill("Назад", onClick = { if (page > 0) page-- }, style = if (page > 0) PillStyle.Soft else PillStyle.Outline)
            Pill("Дальше", onClick = { if (page < 2) page++ }, style = if (page < 2) PillStyle.Soft else PillStyle.Outline)
        }
        Note("Так меняются все экраны приложения: вкладки — столбцом, открытие — вперёд, «назад» и жест «назад» — назад.")
    }
}

@Composable
internal fun CoverFlightNote() =
    Note("Живьём — на главной: «Альбом дня» → «Слушать». Перелёт рисует слой оболочки над всеми экранами, поэтому в карточке его нет.")

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PressDemo() {
    val c = MusixTheme.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Press.entries.forEach { role ->
            Box(Modifier.pressable(role = role) {}.plate(14.dp).padding(horizontal = 16.dp, vertical = 14.dp)) {
                Text("${role.name} · ${roleScale(role)}", style = MusixTheme.text.label.copy(color = c.text))
            }
        }
    }
}

private fun roleScale(r: Press) = when (r) { Press.Icon -> "0.9"; Press.Tab -> "0.94"; Press.Chip -> "0.96"; Press.Row -> "0.99"; Press.Card -> "0.98" }

@Composable
internal fun DebounceDemo() {
    var taps by remember { mutableIntStateOf(0) }
    var runs by remember { mutableIntStateOf(0) }
    val once = rememberDebounced { runs++ }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Pill("Отправить", onClick = { taps++; once() }, style = PillStyle.Accent)
        Text("нажатий $taps · действий $runs", style = MusixTheme.text.number.copy(color = MusixTheme.colors.textMuted))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HapticsDemo() {
    val haptics = LocalMusixHaptics.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            HapticCue.entries.forEach { cue -> Pill(cue.name, onClick = { haptics.perform(cue, fromUser = true) }) }
        }
        Note("Молчит, если вибрация выключена здесь, в настройках приложения или в системе.")
    }
}

@Composable
internal fun RubberDemo() {
    val c = MusixTheme.colors
    val scope = rememberCoroutineScope()
    val shown = remember { Animatable(0f) }
    var raw by remember { mutableFloatStateOf(0f) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth().height(56.dp), contentAlignment = Alignment.Center) {
            val half = constraints.maxWidth / 2f
            Box(Modifier.fillMaxWidth().height(2.dp).background(c.border))
            Box(Modifier.size(width = 64.dp, height = 40.dp).graphicsLayer { translationX = shown.value }.background(c.accent, RoundedCornerShape(999.dp))
                .pointerInput(Unit) {
                    val tracker = VelocityTracker()
                    detectHorizontalDragGestures(
                        onDragStart = { raw = shown.value; tracker.resetTracking() },
                        onDragEnd = { val v = tracker.calculateVelocity().x; scope.launch { shown.animateTo(0f, MusixSprings.gesture(), initialVelocity = v) } },
                        onDragCancel = { scope.launch { shown.animateTo(0f, MusixSprings.gesture()) } },
                    ) { change, d ->
                        raw += d
                        tracker.addPosition(change.uptimeMillis, Offset(raw, 0f))  // the puck moves under the finger: track the finger's path
                        scope.launch { shown.snapTo(raw.sign * rubberBand(abs(raw), half)) }
                    }
                })
        }
        Note("Тяните вбок: чем дальше, тем туже. Отпустите — вернётся с вашей скоростью.")
    }
}

@Composable
internal fun GlassDemo() {
    GlassScene(Modifier.fillMaxWidth().height(150.dp), background = {
        Box(Modifier.matchParentSize().background(Brush.linearGradient(listOf(Color(0xFF5874EA), Color(0xFFFF78C8), Color(0xFFF2B95A)))))
        Box(Modifier.size(70.dp).align(Alignment.TopStart).padding(8.dp).background(Color(0xFF62CEF0), CircleShape))
    }) {
        LiquidGlass(Modifier.align(Alignment.Center).size(width = 200.dp, height = 64.dp), radius = 32.dp) {
            Text("Стекло", Modifier.align(Alignment.Center), style = MusixTheme.text.lead.copy(color = Color.White))
        }
    }
}

@Composable
internal fun MorphMenuDemo() {
    var open by remember { mutableStateOf(false) }
    val morph = rememberMorph(open, rememberReducedMotion())
    var anchor by remember { mutableStateOf<Rect?>(null) }
    val c = MusixTheme.colors
    Box(Modifier.fillMaxWidth().height(230.dp)) {
        Row(Modifier.align(Alignment.TopEnd).onGloballyPositioned { anchor = it.boundsInParent() }.graphicsLayer { alpha = morph.anchorAlpha }) {
            Pill("Сортировка", onClick = { open = true }, leading = { Icon(MusixIcons.List, null, Modifier.size(16.dp), tint = c.text) })
        }
        MorphMenu(morph, anchor, onClose = { open = false }, radiusFrom = 20.dp, scrim = 0.12f) {
            Column(Modifier.padding(8.dp)) {
                listOf("Недавно добавленные", "По названию", "По артисту", "По году").forEach { s ->
                    Text(s, Modifier.fillMaxWidth().pressable(role = Press.Row) { open = false }.padding(horizontal = 12.dp, vertical = 12.dp),
                        style = MusixTheme.text.body.copy(color = c.text))
                }
            }
        }
    }
}

@Composable
internal fun SheetDemo() {
    var open by remember { mutableStateOf(false) }
    val c = MusixTheme.colors
    Pill("Открыть шит", onClick = { open = true }, style = PillStyle.Accent)
    Sheet(open, onClose = { open = false }) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Добавить в плейлист", Modifier.padding(bottom = 8.dp), style = MusixTheme.text.heading.copy(color = c.text))
            ALBUMS.take(4).forEach { (title, artist) ->
                Row(Modifier.fillMaxWidth().pressable(role = Press.Row) { open = false }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Cover(null, title, artist, size = 44.dp)
                    Text(title, style = MusixTheme.text.body.copy(color = c.text))
                }
            }
            Note("Тяните вниз; за серединой — щелчок, и шит закроется.")
        }
    }
}

@Composable
internal fun ToastDemo() {
    val toasts = LocalToasts.current
    var n by remember { mutableIntStateOf(0) }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Pill("Показать тост", onClick = {
            n++
            toasts?.show("Трек $n убран из плейлиста", "Отменить") { toasts.show("Вернули на место") }
        }, style = PillStyle.Accent)
        if (toasts == null) Note("нет стопки в оболочке")
    }
}

@Composable
internal fun RoundButtonDemo() {
    var fire by remember { mutableStateOf(false) }
    var water by remember { mutableStateOf(true) }
    val c = MusixTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        RoundButton(MusixIcons.Fire, "Огонёк", { fire = !fire }, on = fire, toggle = true, accent = c.amber)
        RoundButton(MusixIcons.Water, "Вода", { water = !water }, on = water, toggle = true, accent = c.soundSpace)
        RoundButton(MusixIcons.Shuffle, "Перемешать", {})
        RoundButton(MusixIcons.QueueNext, "Очередь", {})
    }
    // without a fill: the player's bottom row, only the glyph speaks (pressed reactions are filled glyphs)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        RoundButton(if (fire) MusixIcons.FireFilled else MusixIcons.Fire, "Огонёк", { fire = !fire }, on = fire, toggle = true, accent = c.amber, filled = false)
        RoundButton(if (water) MusixIcons.WaterFilled else MusixIcons.Water, "Вода", { water = !water }, on = water, toggle = true, accent = c.soundSpace, filled = false)
        RoundButton(MusixIcons.Plus, "В плейлист", {}, filled = false)
    }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PillDemo() {
    val c = MusixTheme.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Pill("Мягкая", onClick = {})
        Pill("Контур", onClick = {}, style = PillStyle.Outline)
        Pill("Нет в фонотеке", onClick = null, style = PillStyle.Dashed)
        Pill("Выбрана", onClick = {}, style = PillStyle.Accent)
        Pill("С точкой", onClick = {}, leading = { Box(Modifier.size(8.dp).background(c.green, CircleShape)) })
        Pill("С обложкой", onClick = {}, leading = { Cover(null, ALBUMS[3].first, ALBUMS[3].second, size = 26.dp, shadow = false) })
    }
}

@Composable
internal fun TextLinkDemo() {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextLink("Все альбомы артиста", {}, primary = true)
        TextLink("Длинная ссылка, которая переносится на вторую строку — подчёркнута каждая строка", {}, color = MusixTheme.colors.textMuted)
    }
}

@Composable
internal fun TabsDemo() {
    var tab by remember { mutableIntStateOf(0) }
    Tabs(listOf("Альбомы", "Плейлисты", "Треки", "Артисты", "Статистика"), tab, { tab = it })
}

@Composable
internal fun SegmentsDemo() {
    var q by remember { mutableStateOf("lossless") }
    Segments(q, listOf("lossless" to "Lossless", "high" to "320", "economy" to "Эконом"), { q = it })
}

@Composable
internal fun MorphIconDemo() {
    val order = listOf(Glyph.Plus, Glyph.Check, Glyph.Minus, Glyph.Cross)
    var i by remember { mutableIntStateOf(0) }
    var added by remember { mutableStateOf(false) }
    val c = MusixTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(48.dp).pressable(role = Press.Icon) { i = (i + 1) % order.size }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(40.dp).background(c.surface2, CircleShape), contentAlignment = Alignment.Center) { MorphIcon(order[i]) }
        }
        Pill(if (added) "В плейлисте" else "Добавить", onClick = { added = !added }, style = if (added) PillStyle.Accent else PillStyle.Soft,
            leading = { MorphIcon(if (added) Glyph.Check else Glyph.Plus, size = 18.dp, color = if (added) Color.White else c.text) })
    }
}

@Composable
internal fun FieldDemo() {
    val search = rememberTextFieldState()
    val ask = rememberTextFieldState()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SearchField(search, "Песня, альбом, артист")
        GlassField(ask, "Спросить ассистента", imeAction = ImeAction.Send, onSubmit = { ask.edit { replace(0, length, "") } })
    }
}

@Composable
internal fun PlayPauseDemo() {
    var playing by remember { mutableStateOf(false) }
    val t by animateFloatAsState(if (playing) 1f else 0f, MusixSprings.playIcon(), label = "play")
    val c = MusixTheme.colors
    Box(Modifier.size(64.dp).pressable(role = Press.Icon) { playing = !playing }.background(c.accent, CircleShape), contentAlignment = Alignment.Center) {
        PlayPauseGlyph(t, Modifier.size(26.dp), Color.White)
    }
}

@Composable
internal fun CoverDemo() {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Cover(null, ALBUMS[1].first, ALBUMS[1].second, size = 88.dp)
        Cover(null, ALBUMS[4].first, ALBUMS[4].second, size = 88.dp)
        MosaicCover(listOf(null, null, null, null), size = 88.dp)
    }
}

@Composable
internal fun LoadingDemo() {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Skel(Modifier.size(48.dp), radius = 10.dp)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Skel(Modifier.size(width = 160.dp, height = 14.dp))
                Skel(Modifier.size(width = 100.dp, height = 12.dp))
            }
            Spacer(Modifier.weight(1f))
            Spinner(20.dp)
        }
        Empty("В этом плейлисте пока пусто", Modifier.fillMaxWidth())
    }
}

@Composable
internal fun StateHostDemo(state: String) {
    var retries by remember { mutableIntStateOf(0) }
    val s: ScreenState<List<Pair<String, String>>> = when (state) {
        "Пусто" -> ScreenState.Empty("Здесь появятся ваши плейлисты")
        "Ошибка" -> ScreenState.Failed("Сервер не ответил${if (retries > 0) " · повторов: $retries" else ""}")
        "Готово" -> ScreenState.Ready(ALBUMS.take(3))
        else -> ScreenState.Loading
    }
    StateHost(s, Modifier.fillMaxWidth().height(150.dp), onRetry = { retries++ }) { rows ->
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            rows.forEach { (title, artist) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Cover(null, title, artist, size = 36.dp)
                    Column {
                        Text(title, style = MusixTheme.text.body.copy(color = MusixTheme.colors.text))
                        Note(artist)
                    }
                }
            }
        }
    }
}

@Composable
internal fun MarkdownDemo() {
    Markdown(
        "**Тёплый шум** — второй альбом группы *Озеро*, записан на плёнку за две недели.\n\n" +
            "- медленные гитары\n- шум прибоя в конце\n\nЛучше всего — в наушниках, `24-bit`.",
        style = MusixTheme.text.reading.copy(color = MusixTheme.colors.text),
    )
}
