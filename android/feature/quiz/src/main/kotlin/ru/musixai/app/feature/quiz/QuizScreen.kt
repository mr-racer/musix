package ru.musixai.app.feature.quiz

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.QuizAnswer
import ru.musixai.app.core.data.QuizMode
import ru.musixai.app.core.data.QuizRepository
import ru.musixai.app.core.data.QuizRound
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject

data class QuizUi(val modes: List<QuizMode> = emptyList(), val round: QuizRound? = null, val answer: QuizAnswer? = null, val picked: String? = null,
    val busy: Boolean = false, val streak: Int = 0, val error: String? = null)

@HiltViewModel
class QuizViewModel @Inject constructor(private val repo: QuizRepository, private val player: PlayerController) : ViewModel() {
    private val _ui = MutableStateFlow(QuizUi())
    val ui: StateFlow<QuizUi> = _ui

    init { viewModelScope.launch { _ui.update { it.copy(modes = runCatching { repo.modes() }.getOrDefault(emptyList())) } } }

    fun start(mode: String) = viewModelScope.launch {
        _ui.update { it.copy(busy = true, answer = null, picked = null, error = null) }
        val r = runCatching { repo.round(mode) }
        _ui.update { it.copy(busy = false, round = r.getOrNull(), error = r.exceptionOrNull()?.let { "В этом режиме пока мало материала" }) }
        r.getOrNull()?.audioUrl?.let { replay() }
    }

    /** Through the player core in its no-listen mode (quiz invariant I-2). */
    fun replay() { _ui.value.round?.let { r -> r.audioUrl?.let { player.snippet(it, (r.lengthSec * 1000).toLong()) } } }
    fun optionAudio(url: String) = player.snippet(url, ((_ui.value.round?.lengthSec ?: 3.0) * 1000).toLong())

    fun answer(optionId: String) = viewModelScope.launch {
        val r = _ui.value.round ?: return@launch
        if (_ui.value.answer != null) return@launch
        _ui.update { it.copy(picked = optionId) }
        val a = runCatching { repo.answer(r.id, optionId) }.getOrNull() ?: return@launch
        _ui.update { it.copy(answer = a, streak = if (a.correct) it.streak + 1 else 0) }
    }

    fun back() = _ui.update { it.copy(round = null, answer = null, picked = null) }
}

private val MODES = mapOf(
    "track_snippet" to Triple("Что играет", "Три секунды из твоей фонотеки. Узнаешь?", 270f),
    "producer" to Triple("Почерк продюсера", "Три трека сделал один человек. Найди чужой.", 75f),
    "blind_year" to Triple("Слепой год", "В каком году это записали?", 200f),
    "lineage" to Triple("Родословная", "На чём вырос этот трек?", 330f),
)

/** v1 `QuizSection` («Викторина», golden quiz-*-phone): the mode cards, then the round. */
@Composable
fun QuizRoute(vm: QuizViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val c = MusixTheme.colors
    Box(Modifier.fillMaxSize().background(c.bg)) {
        Box(Modifier.fillMaxWidth().height(420.dp).background(Brush.radialGradient(listOf(Color(0x33384A8C), Color.Transparent), center = Offset(540f, 0f), radius = 900f)))
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val r = ui.round
            if (r == null) {
                Text("Викторина", Modifier.padding(top = 150.dp), style = MusixTheme.type.title.copy(fontFamily = MusixFontFamilies.Playfair, fontSize = 38.sp, fontWeight = FontWeight.Normal, color = c.text))
                Text("Игра по твоей собственной фонотеке.", Modifier.padding(top = 10.dp, bottom = 28.dp), style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.textMuted))
                ui.error?.let { Text(it, Modifier.padding(bottom = 12.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.amber)) }
                val keys = ui.modes.map { it.key }.ifEmpty { MODES.keys.toList() }
                for (k in keys) {
                    val (title, sub, hue) = MODES[k] ?: Triple(k, "", 270f)
                    val available = ui.modes.firstOrNull { it.key == k }?.available ?: true
                    ModeCard(title, sub, hue, available) { vm.start(k) }
                }
                if (ui.busy) Spinner(22.dp)
            } else Round(ui, r, vm)
        }
    }
}

@Composable
private fun ModeCard(title: String, sub: String, hue: Float, available: Boolean, onClick: () -> Unit) {
    val c = MusixTheme.colors
    val shape = RoundedCornerShape(24.dp)
    Column(Modifier.padding(bottom = 14.dp).fillMaxWidth().clip(shape).background(Brush.verticalGradient(listOf(Color(0xFF1B1B20), Color(0xFF141418))))
        .border(1.dp, c.border, shape).pressable(available, onClick)) {
        Box(Modifier.padding(horizontal = 18.dp).fillMaxWidth().height(2.dp).background(Brush.horizontalGradient(listOf(oklch(65f, 0.15f, hue), oklch(65f, 0.15f, hue, 0f)))))
        Column(Modifier.padding(horizontal = 18.dp, vertical = 20.dp)) {
            Text(title, style = MusixTheme.type.body.copy(fontSize = 17.sp, fontWeight = FontWeight.Bold, color = c.text.copy(alpha = if (available) 1f else 0.5f)))
            Text(if (available) sub else "Пока мало материала в библиотеке", Modifier.padding(top = 8.dp), style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.textMuted))
        }
    }
}

@Composable
private fun Round(ui: QuizUi, r: QuizRound, vm: QuizViewModel) {
    val c = MusixTheme.colors
    Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(MusixIcons.ChevronLeft, "Назад", Modifier.size(38.dp).pressable(onClick = vm::back).padding(8.dp), tint = c.text)
        Text(MODES[r.mode]?.first ?: r.mode, Modifier.weight(1f), textAlign = TextAlign.Center, style = MusixTheme.type.body.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.text))
        Text("серия ${ui.streak}", style = MusixTheme.type.mono.copy(fontSize = 12.sp, color = c.amber))
    }
    if (r.audioUrl != null) Box(Modifier.padding(vertical = 40.dp).size(120.dp).clip(CircleShape)
        .background(Brush.radialGradient(listOf(Color(0xFF8A96FF), Color(0xFF4F46E0)))).pressable(onClick = vm::replay), contentAlignment = Alignment.Center) {
        Icon(MusixIcons.Play, "Ещё раз", Modifier.size(40.dp), tint = Color.White)
    }
    for (o in r.options) {
        val a = ui.answer
        val right = a != null && o.id == a.correctOptionId
        val wrong = a != null && o.id == ui.picked && !a.correct
        val shape = RoundedCornerShape(16.dp)
        Row(Modifier.padding(bottom = 10.dp).fillMaxWidth().clip(shape)
            .background(when { right -> c.greenBg; wrong -> c.redBg; else -> c.surface })
            .border(1.dp, when { right -> c.green; wrong -> c.red; else -> c.border }, shape)
            .pressable { vm.answer(o.id) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(o.title, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
                Text(listOfNotNull(o.artist, o.year).joinToString(" · "), style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.textMuted))
            }
            o.audioUrl?.let { u -> Icon(MusixIcons.Play, "Послушать", Modifier.size(36.dp).pressable { vm.optionAudio(u) }.padding(9.dp), tint = c.textMuted) }
        }
    }
    ui.answer?.let { a ->
        Text(if (a.correct) "Верно!" else "Мимо", Modifier.padding(top = 10.dp), style = MusixTheme.type.body.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold, color = if (a.correct) c.green else c.red))
        CtaButton("Ещё раунд", { vm.start(r.mode) }, Modifier.padding(vertical = 16.dp).fillMaxWidth())
    }
}
