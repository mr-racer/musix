package ru.musixai.app.feature.player

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.brush
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.pressable

/** v1 `TRACK_CHAT_SUGGESTED_PROMPTS`: the chip shows the label; a tap drops the full question into the input to read or edit. */
private val PROMPTS = listOf(
    Triple("💭", "О чём песня?", "О чём эта песня на самом деле? Расскажи простыми словами, как будто объясняешь другу."),
    Triple("📖", "История", "Расскажи историю создания этой песни и насколько популярной она была, когда вышла."),
    Triple("✍️", "Сильные строчки", "Разбери пару самых сильных строчек: есть ли в них отсылки или скрытый смысл?"),
    Triple("💿", "Семплы", "Какие песни семплировались в этом треке? Расскажи, откуда взяты семплы."),
)

/**
 * v1 `AIChatDrawer` as its own sheet over the player, not a panel under the song (the owner,
 * 2026-10-02). It has:
 * - a slim header («✨ Чат по треку», ↺ a new chat, ✕);
 * - a breathing orb and an invitation while the chat is empty;
 * - the bubbles, with the live stage of the answer;
 * - the four template chips above the input.
 * It slides up in 280 ms (v1's curve) and the back gesture closes it.
 */
@Composable
fun TrackChatSheet(ui: PlayerUi, vm: PlayerViewModel) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(ui.chatOpen, enter = fadeIn(tween(200)), exit = fadeOut(tween(200))) {
            Box(Modifier.fillMaxSize().background(Color(0x66000000)).quietTap { vm.toggleChat() })
        }
        AnimatedVisibility(ui.chatOpen, Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically(tween(280, easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f))) { it } + fadeIn(tween(280)),
            exit = slideOutVertically(tween(240)) { it } + fadeOut(tween(200))) {
            BackHandler(ui.chatOpen) { vm.toggleChat() }
            var input by remember { mutableStateOf(TextFieldValue("")) }
            val focus = remember { FocusRequester() }
            val send = { val t = input.text.trim(); if (t.isNotEmpty() && ui.chatStage == null) { vm.ask(t); input = TextFieldValue("") } }
            val top = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.78f).clip(top)
                .background(if (dark) Color(0xF2121218) else Color(0xF7FBFAFF))
                .border(1.dp, c.border, top)
                .quietTap { }  // a tap inside never reaches the scrim
                .navigationBarsPadding().imePadding()) {
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(c.textSubtle.copy(alpha = 0.4f)))
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("✨", style = MusixTheme.type.body.copy(fontSize = 15.sp))
                    Text("Чат по треку", Modifier.weight(1f).padding(start = 8.dp),
                        style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                    if (ui.chat.isNotEmpty()) HeaderPill("↺") { vm.clearChat() }
                    Spacer(Modifier.size(8.dp))
                    HeaderPill("✕") { vm.toggleChat() }
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
                if (ui.chat.isEmpty() && ui.chatStage == null) {
                    Column(Modifier.weight(1f).fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        BreathingOrb()
                        Text("Спросите про этот трек", Modifier.padding(top = 16.dp), style = MusixTheme.type.body.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                        Text("Смысл, история, семплы, отсылки — или выберите подсказку ниже.", Modifier.padding(top = 6.dp).widthIn(max = 280.dp), textAlign = TextAlign.Center,
                            style = MusixTheme.type.body.copy(fontSize = 13.sp, lineHeight = 1.45.em, color = c.textMuted))
                    }
                } else {
                    val scroll = rememberScrollState()
                    LaunchedEffect(ui.chat.size, ui.chatStage, ui.chatStream?.length?.div(80)) { scroll.animateScrollTo(scroll.maxValue) }
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        for ((mine, text) in ui.chat) Bubble(mine, text)
                        // the reply grows in its bubble while the model writes; the stage line until the first words
                        ui.chatStream?.let { Bubble(false, it) } ?: ui.chatStage?.let { stage ->
                            Row(Modifier.clip(RoundedCornerShape(14.dp, 14.dp, 14.dp, 4.dp)).background(c.aiBubble).padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Spinner(12.dp)
                                Text("  $stage", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
                            }
                        }
                    }
                }
                // the template rail above the input (v1 `.tc-chip-rail`)
                Box(Modifier.fillMaxWidth().height(1.dp).background(c.border))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 9.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    for ((icon, label, prompt) in PROMPTS) {
                        Row(Modifier.clip(RoundedCornerShape(999.dp)).background(if (dark) Color(0x0FFFFFFF) else Color(0x0A000000))
                            .border(1.dp, c.border, RoundedCornerShape(999.dp))
                            .pressable { input = TextFieldValue(prompt, TextRange(prompt.length)); runCatching { focus.requestFocus() } }
                            .padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(icon, style = MusixTheme.type.body.copy(fontSize = 13.sp))
                            Text(" $label", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.text))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(input, { input = it }, Modifier.weight(1f).focusRequester(focus).clip(RoundedCornerShape(12.dp))
                        .background(if (dark) Color(0x0DFFFFFF) else Color(0x0A000000)).border(1.dp, c.border, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 11.dp),
                        textStyle = MusixTheme.type.body.copy(fontSize = 15.sp, lineHeight = 1.4.em, color = c.text), cursorBrush = SolidColor(c.accentLight), maxLines = 4,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }),
                        decorationBox = { inner -> Box { if (input.text.isEmpty()) Text("Спросить про этот трек…", style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.textSubtle)); inner() } })
                    Spacer(Modifier.size(8.dp))
                    val ready = input.text.isNotBlank() && ui.chatStage == null
                    Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp))
                        .background(if (ready) Brush.verticalGradient(listOf(Color(0xFF7C6BFF), Color(0xFF5B45E0))) else SolidColor(if (dark) Color(0x0AFFFFFF) else Color(0x0A000000)))
                        .pressable(enabled = ready) { send() }, contentAlignment = Alignment.Center) {
                        Icon(MusixIcons.Next, "Отправить", Modifier.size(18.dp), tint = if (ready) Color.White else c.textSubtle)
                    }
                }
            }
        }
    }
}

/** A tap with no ripple or press scale: the scrim, and the sheet's own body. */
private fun Modifier.quietTap(onClick: () -> Unit): Modifier = composed {
    clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick)
}

@Composable
private fun HeaderPill(glyph: String, onClick: () -> Unit) {
    val c = MusixTheme.colors
    Box(Modifier.size(width = 38.dp, height = 32.dp).clip(RoundedCornerShape(999.dp)).border(1.dp, c.border, RoundedCornerShape(999.dp)).pressable(onClick = onClick),
        contentAlignment = Alignment.Center) {
        Text(glyph, style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.textMuted))
    }
}

/** A chat bubble: mine as typed, the assistant's as markdown (its lists, quotes and links; never bold). */
@Composable
private fun Bubble(mine: Boolean, text: String) {
    val c = MusixTheme.colors
    val style = MusixTheme.type.body.copy(fontSize = 14.5.sp, lineHeight = 1.5.em, color = if (mine) Color.White else c.text)
    Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        val shell = Modifier.widthIn(max = 300.dp)
            .clip(if (mine) RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp) else RoundedCornerShape(14.dp, 14.dp, 14.dp, 4.dp))
            .then(if (mine) Modifier.background(c.userBubble.brush(500f, 120f)) else Modifier.background(c.aiBubble))
            .padding(horizontal = 13.dp, vertical = 9.dp)
        if (mine) Text(text, shell, style = style) else ru.musixai.app.core.designsystem.component.Markdown(text, style, shell)
    }
}

/** v1 `.tc-hero-orb`: a violet orb breathing while the chat waits for its first question. */
@Composable
private fun BreathingOrb() {
    val t = rememberInfiniteTransition(label = "orb")
    val k by t.animateFloat(0f, 1f, infiniteRepeatable(tween(2400), RepeatMode.Reverse), label = "k")
    Canvas(Modifier.size(64.dp).graphicsLayer { val s = 0.92f + 0.08f * k; scaleX = s; scaleY = s }) {
        drawCircle(Brush.radialGradient(listOf(Color(0x667C5BFF), Color(0x007C5BFF)), radius = size.minDimension * 0.75f), radius = size.minDimension * 0.75f)
        drawCircle(Brush.radialGradient(listOf(Color(0xFFC9B8FF), Color(0xFF7C5BFF), Color(0xFF4A35C8)), center = Offset(size.width * 0.38f, size.height * 0.34f), radius = size.minDimension * 0.6f),
            radius = size.minDimension * 0.36f)
    }
}
