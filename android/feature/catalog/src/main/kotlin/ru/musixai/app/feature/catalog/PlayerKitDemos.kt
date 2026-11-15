package ru.musixai.app.feature.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.AskedLine
import ru.musixai.app.core.designsystem.content.Cover
import ru.musixai.app.core.designsystem.motion.TextShimmer
import ru.musixai.app.core.designsystem.content.TurnRule
import ru.musixai.app.core.designsystem.control.FoldingComposer
import ru.musixai.app.core.designsystem.control.Richbox
import ru.musixai.app.core.designsystem.control.RichboxState
import ru.musixai.app.core.designsystem.gesture.SwipeToRemove
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.text

internal val RICHBOX_STATES = listOf("Ждёт", "Пусто", "Четверть", "Готово", "Отменено", "Ошибка")

@Composable
internal fun RichboxDemo(state: String) {
    val i = RICHBOX_STATES.indexOf(state).coerceAtLeast(0)
    val s = when (i) { 0 -> RichboxState.Waiting; 1 -> RichboxState.Empty; 2 -> RichboxState.Progress25; 3 -> RichboxState.Done; 4 -> RichboxState.Cancelled; else -> RichboxState.Error }
    Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
        Richbox(s, size = 24.dp)
        Richbox(s, size = 40.dp)
        Text(RICHBOX_STATES[i], style = MusixTheme.text.label.copy(color = MusixTheme.colors.textMuted))
    }
}

/** The field rolls up into its button for 2.6 s of a pretend answer, then unrolls. */
@Composable
internal fun ComposerDemo() {
    var text by remember { mutableStateOf("") }
    var folded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var rb by remember { mutableStateOf(RichboxState.Empty) }
    var status by remember { mutableStateOf("") }
    var run by remember { mutableStateOf(0) }
    LaunchedEffect(run) {
        if (run == 0) return@LaunchedEffect
        folded = true; busy = true; rb = RichboxState.Waiting
        status = "Читаю факты о песне…"; delay(1300)
        status = "Собираю ответ…"; delay(1300)
        busy = false; rb = RichboxState.Done; status = "Готово"; delay(520)
        folded = false; status = ""; delay(300); rb = RichboxState.Empty
    }
    FoldingComposer(text, { text = it }, "Спросить о песне…", folded, busy, rb, status,
        onSend = { text = ""; run++ }, onStop = { busy = false; rb = RichboxState.Cancelled; status = "Остановлено"; folded = false })
}

@Composable
internal fun ConversationDemo() {
    val accent = Color(0xFFE2843A)
    Column(Modifier.fillMaxWidth()) {
        AskedLine("Что значит название «Frozen»?", accent)
        Text("Ответ ассистента — абзац простыми словами, по фактам о песне и её тексту.", Modifier.padding(top = 12.dp),
            style = MusixTheme.text.reading.copy(fontSize = 15.sp, color = MusixTheme.colors.text))
        TurnRule(accent, Modifier.padding(vertical = 14.dp))
        AskedLine("О чём эта песня?", accent)
        TextShimmer("Сверяю с текстом…", Modifier.padding(top = 12.dp))
    }
}

@Composable
internal fun SwipeDemo() {
    val rows = remember { mutableStateListOf("Frozen" to "Madonna", "Exits" to "Foals", "Power" to "Kanye West") }
    val toasts = LocalToasts.current
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        SwipeToRemove(onRemove = {}, enabled = false, onReject = { toasts?.show("Играющую песню убрать нельзя") }) { DemoRow("Играет сейчас", "смахнуть нельзя") }
        rows.toList().forEach { a ->
            SwipeToRemove(onRemove = {
                val at = rows.indexOf(a); rows.remove(a)
                toasts?.show("Убрано: ${a.first}", "Вернуть") { rows.add(at.coerceAtMost(rows.size), a) }
            }) { DemoRow(a.first, a.second) }
        }
    }
}

@Composable
private fun DemoRow(title: String, artist: String) {
    val c = MusixTheme.colors
    Row(Modifier.fillMaxWidth().height(60.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Cover(null, title, artist, size = 44.dp, radius = 8.dp, shadow = false)
        Column(Modifier.weight(1f)) {
            Text(title, maxLines = 1, style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
            Text(artist, maxLines = 1, style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textMuted))
        }
    }
}

