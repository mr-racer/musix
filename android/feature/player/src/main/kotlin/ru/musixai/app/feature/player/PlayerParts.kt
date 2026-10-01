package ru.musixai.app.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.player.Handoff
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixMotion
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.model.Image
import ru.musixai.app.core.player.QueueMode
import kotlin.math.abs
import kotlin.math.sin
import kotlin.random.Random

/** The cover: tap = play/pause, a horizontal swipe = next/previous with v1's vinyl motion
 *  (320 ms in / 600 ms out), flank arrows, and the огонёк/вода combustion around it. */
/** v1 `CoverCombustion` + `.cover-fx__aura`: fire licks up from the bottom rim in amber, water
 *  pours from the top in blue — an aura that swells and fades over 2.2 s, with particles. */
@Composable
fun Combustion(kind: String, nonce: Long, modifier: Modifier) {
    val t = remember(nonce) { Animatable(0f) }
    LaunchedEffect(nonce) { t.snapTo(0f); t.animateTo(1f, tween(2200)) }
    val fire = kind == "fire"
    val seeds = remember(nonce) { List(46) { Triple(Random.nextFloat(), Random.nextFloat(), Random.nextFloat()) } }
    Canvas(modifier.graphicsLayer { scaleX = 1.2f; scaleY = 1.35f }) {
        val k = t.value
        if (k >= 1f) return@Canvas
        val aura = when { k < 0.16f -> k / 0.16f; k < 0.58f -> 1f - (k - 0.16f) / 0.42f * 0.22f; else -> 0.78f * (1f - (k - 0.58f) / 0.42f) }
        val cy = if (fire) size.height * 0.8f else size.height * 0.3f
        drawRect(Brush.radialGradient(
            0f to (if (fire) Color(0xFFFF9220) else Color(0xFF3CA8FF)).copy(alpha = 0.55f * aura),
            0.56f to (if (fire) Color(0xFFFF4800) else Color(0xFF2874FF)).copy(alpha = 0.2f * aura),
            0.72f to Color.Transparent, center = Offset(size.width / 2, cy), radius = size.width * 0.62f))
        for ((a, b, s) in seeds) {
            val life = ((k * 1.6f - a * 0.6f).coerceIn(0f, 1f))
            if (life <= 0f || life >= 1f) continue
            val x = size.width * (0.1f + 0.8f * b) + sin((life + s) * 9f) * 14f
            val y = if (fire) size.height * (0.92f - life * (0.55f + 0.3f * s)) else size.height * (0.08f + life * (0.6f + 0.3f * s))
            val r = (if (fire) 10f else 6f) * (1f - life) + 2f
            drawCircle((if (fire) Color(0xFFFFB347) else Color(0xFF8FD3FF)).copy(alpha = 0.75f * (1f - life)), r, Offset(x, y))
        }
    }
}

/** The scrubber: times in the label voice, an amber fill, and the track's energy envelope
 *  (4 bands, 10 fps, from the server) drawn behind it — the spectrum wave without an
 *  AnalyserNode or RECORD_AUDIO (spec §4). */
@Composable
fun Scrubber(positionMs: Long, durationMs: Long, envelope: ByteArray?, onSeek: (Long) -> Unit, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    val frac = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    var dragFrac by remember { mutableStateOf<Float?>(null) }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(fmt(positionMs), Modifier.width(44.dp), style = MusixTheme.type.code.copy(fontSize = 12.sp, color = c.textMuted))
        Canvas(
            Modifier.weight(1f).height(34.dp)
                .pointerInput(durationMs) {
                    detectTapGestures { o -> if (durationMs > 0) onSeek((o.x / size.width * durationMs).toLong()) }
                }
                .pointerInput(durationMs) {
                    detectHorizontalDragGestures(
                        onDragStart = { o -> dragFrac = o.x / size.width },
                        onDragEnd = { dragFrac?.let { if (durationMs > 0) onSeek((it * durationMs).toLong()) }; dragFrac = null },
                    ) { ch, _ -> dragFrac = (ch.position.x / size.width).coerceIn(0f, 1f) }
                },
        ) {
            val f = dragFrac ?: frac
            val mid = size.height / 2
            if (envelope != null && envelope.size >= 4) {
                val frames = envelope.size / 4
                val bars = 64
                val bw = size.width / bars
                for (i in 0 until bars) {
                    val fr = (i.toFloat() / bars * frames).toInt().coerceIn(0, frames - 1)
                    val e = (0 until 4).maxOf { b -> envelope[fr * 4 + b].toInt() and 0xFF } / 255f
                    val h = (size.height * 0.85f * e).coerceAtLeast(2f)
                    val played = (i + 0.5f) / bars <= f
                    drawRoundRect((if (played) c.amber else c.textSubtle).copy(alpha = if (played) 0.55f else 0.22f),
                        Offset(i * bw + bw * 0.2f, mid - h / 2), Size(bw * 0.6f, h), CornerRadius(bw * 0.3f))
                }
            }
            drawRoundRect(c.textSubtle.copy(alpha = 0.35f), Offset(0f, mid - 3f), Size(size.width, 6f), CornerRadius(3f))
            drawRoundRect(c.amber, Offset(0f, mid - 3f), Size((size.width * f).coerceAtLeast(12f), 6f), CornerRadius(3f))
        }
        Text(fmt(durationMs), Modifier.width(44.dp).padding(start = 8.dp), style = MusixTheme.type.code.copy(fontSize = 12.sp, color = c.textMuted))
    }
}

internal fun fmt(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

/** fire · water · add · lyrics · shuffle (no transport row on phones: the cover is play/pause,
 *  the flank arrows and the swipe are prev/next — v1). */
@Composable
fun ActionRow(ui: PlayerUi, vm: PlayerViewModel, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    val p = ui.player
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        TasteButton(MusixIcons.Fire, "Огонёк", Color(0xFFFF7A18), p.taste == "fire", p.taste == "fire" && p.tasteLocked) { vm.react("fire") }
        TasteButton(MusixIcons.Water, "Вода", Color(0xFF38BDF8), p.taste == "water", p.taste == "water" && p.tasteLocked) { vm.react("water") }
        ActionIcon(MusixIcons.Plus, "В плейлист") { vm.openAdd(true) }
        ActionIcon(MusixIcons.Lyrics, "Текст", active = ui.lyricsOpen) { vm.toggleLyrics() }
        ActionIcon(MusixIcons.Sparkles, "Спросить о песне", active = ui.chatOpen) { vm.toggleChat() }
        if (p.mode != QueueMode.STREAM) ActionIcon(MusixIcons.Shuffle, "Перемешать", active = p.shuffle) { vm.shuffle() }
        ActionIcon(MusixIcons.Devices, "Слушать на…", active = ui.devicesOpen) { vm.openDevices(!ui.devicesOpen) }
    }
}

private val KIND = mapOf("android" to "Телефон", "windows" to "Компьютер", "web" to "Браузер")

/** «Слушать на…» (phase 8 §1): the account's devices online now; a tap hands the music over. */
@Composable
fun DevicesCard(ui: PlayerUi, vm: PlayerViewModel, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.surface).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("Слушать на…", Modifier.weight(1f))
            Text("Закрыть", Modifier.pressable { vm.openDevices(false) }, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
        }
        val list = ui.devices
        if (list == null) { Text("Ищу устройства…", Modifier.padding(vertical = 8.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted)); return@Column }
        DeviceRow("Этот телефон", "играет здесь", here = true, enabled = false) {}
        val others = list.filter { !it.current }
        for (d in others) DeviceRow(d.name, (KIND[d.platform] ?: d.platform) + if (d.active) " · играет" else "", here = false, enabled = d.canPlay) { vm.transferTo(d.id) }
        if (others.isEmpty()) Text("Других устройств онлайн нет. Откройте MusiX в браузере или на компьютере — он появится здесь.",
            Modifier.padding(vertical = 6.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted, lineHeight = 1.45.em))
    }
}

@Composable
private fun DeviceRow(name: String, sub: String, here: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = MusixTheme.colors
    val tint = if (here) c.accentLight else c.text
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).pressable(enabled && !here, onClick).padding(vertical = 10.dp, horizontal = 6.dp)
        .graphicsLayer { alpha = if (enabled || here) 1f else 0.5f }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(MusixIcons.Devices, null, Modifier.size(18.dp), tint = tint)
        Column {
            Text(name, style = MusixTheme.type.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = tint), maxLines = 1)
            Text(sub, style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = if (here) c.accentLight.copy(alpha = 0.8f) else c.textSubtle))
        }
    }
}

/** «Играет на …»: the account plays elsewhere; one tap brings it to this phone. */
@Composable
fun ElsewhereBar(ui: PlayerUi, vm: PlayerViewModel, modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    if (ui.remote == null) return
    Row(modifier.clip(RoundedCornerShape(999.dp)).background(c.accent.copy(alpha = 0.16f)).border(1.dp, c.accent.copy(alpha = 0.4f), RoundedCornerShape(999.dp))
        .padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(MusixIcons.Devices, null, Modifier.size(16.dp), tint = c.text)
        Text("Играет на другом устройстве", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.text))
        Box(Modifier.clip(RoundedCornerShape(999.dp)).background(c.accent).pressable { vm.bringHere() }.padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text("Слушать здесь", style = MusixTheme.type.body.copy(fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Color.White))
        }
    }
}

@Composable
private fun ActionIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, active: Boolean = false, onClick: () -> Unit) {
    val c = MusixTheme.colors
    Box(Modifier.size(44.dp).pressable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, Modifier.size(20.dp), tint = if (active) c.accentLight else c.textMuted)
    }
}

@Composable
private fun TasteButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, fill: Color, active: Boolean, locked: Boolean, onClick: () -> Unit) {
    val c = MusixTheme.colors
    Box(Modifier.size(44.dp).graphicsLayer { alpha = if (locked) 0.5f else 1f }.pressable(!locked, onClick), contentAlignment = Alignment.Center) {
        if (active) Icon(icon, null, Modifier.size(20.dp), tint = fill.copy(alpha = 0.9f))
        Icon(icon, label, Modifier.size(20.dp), tint = if (active) fill else c.textMuted)
    }
}

@Composable
fun LosslessMark(modifier: Modifier = Modifier) {
    val c = MusixTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(MusixIcons.LosslessMark, "Lossless", Modifier.size(width = 44.dp, height = 26.dp), tint = c.text.copy(alpha = 0.65f))
        Text("Lossless", style = MusixTheme.type.body.copy(fontSize = 20.sp, color = c.text.copy(alpha = 0.65f)))
    }
}
