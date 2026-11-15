package ru.musixai.app.feature.player

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import ru.musixai.app.core.designsystem.control.SongLine
import ru.musixai.app.core.designsystem.surface.ProvideGlassSource
import ru.musixai.app.core.designsystem.surface.glassSource
import ru.musixai.app.core.designsystem.surface.rememberGlassSource
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.control.RoundButton
import ru.musixai.app.core.designsystem.control.Segments
import ru.musixai.app.core.designsystem.control.TextLink
import ru.musixai.app.core.designsystem.control.PlayPauseGlyph
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.hexColor
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.text
import ru.musixai.app.core.player.QueueMode

@Composable
fun PlayerRoute(fold: PlayerFold, onArtist: (String) -> Unit, onAlbum: (String) -> Unit = {}, vm: PlayerViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    PlayerScreen(ui, vm, fold, onArtist, onAlbum)
}

internal enum class PlayerSheet { About, Queue, Ask }

/** The ask sheet's opening: about the song, about lines of its words, or with a question already asked. */
internal data class AskFor(val quote: List<String>? = null, val ask: String? = null)

/** Text roles of the player (the mock's type: Geist UI, Noto Sans reading, JetBrains Mono time). */
private val TitleStyle @Composable get() = MusixTheme.text.title.copy(fontSize = 34.sp, lineHeight = 1.02.em, letterSpacing = (-0.035).em)

/**
 * The player (round 3 of the phone mock, 2026-11-14; the owner took «Перелист» and scene A,
 * 2026-11-15): one screen without scrolling, the cover as its hero. One stage, three sides —
 * the cover, its back with the words, the sound's cast. Everything else comes when it is called:
 * «О песне» from the phrase, the queue from «Далее», «Спросить» from the bottom row.
 */
@Composable
internal fun PlayerScreen(ui: PlayerUi, vm: PlayerViewModel, fold: PlayerFold, onArtist: (String) -> Unit, onAlbum: (String) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val p = ui.player
    val ctx = ui.context
    val haptics = LocalMusixHaptics.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val reduced = rememberReducedMotion()
    val palette = ctx?.image?.palette
    val accent = hexColor(if (dark) palette?.accentDark ?: palette?.vibrant else palette?.accentLight ?: palette?.dominant) ?: c.accent
    val accent2 = hexColor(palette?.muted) ?: c.accent
    val sound = ui.sound
    val blocked = p.trackId == null

    var side by rememberSaveable { mutableStateOf(Side.Cover) }
    if (side == Side.Sound && sound == null) side = Side.Cover
    var sheet by remember { mutableStateOf<PlayerSheet?>(null) }
    var askFor by remember { mutableStateOf(AskFor()) }
    var scaleKey by remember { mutableStateOf<String?>(null) }    // a scale picked on the sound side
    var scrubbing by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var addAnchor by remember { mutableStateOf<Rect?>(null) }
    var added by remember(p.trackId) { mutableStateOf<Pair<String?, String>?>(null) }
    val toasts = ru.musixai.app.core.designsystem.surface.LocalToasts.current
    val turn = remember { PageTurn(scope) }
    val light = remember { PlayerLight() }
    val lit = remember { LitMoment() }
    val bursts = rememberBursts()
    val clock = rememberClock(p.positionMs, p.isPlaying, scrubbing)
    val hint = rememberHint()
    WarmSoftCovers(listOfNotNull(p.queue.getOrNull(p.index - 1)?.artUri, p.artUri, p.queue.getOrNull(p.index + 1)?.artUri))

    val foldDrag = remember(fold) {
        object : FoldDrag {
            override fun grab() { fold.grab(); hint.hide(false) }
            override fun drag(dy: Float) { scope.launch { if (fold.drag(dy)) haptics.perform(if (fold.past) HapticCue.Threshold else HapticCue.ThresholdOff, fromUser = true) } }
            override fun release(vy: Float, cancel: Boolean) { scope.launch { fold.release(vy, cancel) } }
        }
    }
    val toggle = {
        haptics.perform(HapticCue.Press, fromUser = true)
        hint.hide(true)
        vm.toggle()
    }
    // the player steps back while a sheet is over it
    val back by animateFloatAsState(if (sheet != null) 1f else 0f, springKcm(260f, 30f), label = "back")

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val screenW = maxWidth
        val screenH = maxHeight
        // what the system bars really take (gesture or button navigation, a cutout)
        val bars = with(density) { (WindowInsets.statusBars.getTop(density) + WindowInsets.navigationBars.getBottom(density)).toDp() }
        val e = { fold.p.value.coerceIn(0f, 1f) }
        // the player's own picture for its glass (the sheet host cuts the shared one off inside it)
        val playerGlass = rememberGlassSource()
        Box(Modifier.fillMaxSize().glassSource(playerGlass)) { PlayerBackdrop(light, accent2, fade = { val k = e(); 1f - k * k }) }
        ProvideGlassSource(playerGlass) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().graphicsLayer {
                val o = back
                scaleX = 1f - 0.035f * o; scaleY = 1f - 0.035f * o; translationY = -6.dp.toPx() * o
            },
        ) {
            val geo = geometry(screenW, screenH - bars)
            val away = Modifier.graphicsLayer { val k = e(); alpha = (1f - k * 2.4f).coerceIn(0f, 1f); translationY = k * 36.dp.toPx() }

            // the top bar: fold, the file's quality, the pause of the words and sound sides; a handle too
            TopBar(ctx?.lossless == true, side != Side.Cover, p.isPlaying, onFold = { scope.launch { fold.to(true) } }, onToggle = toggle, fold = foldDrag, modifier = away)

            // the stage, measured where it stands open (the fold flies it into the bar's cover)
            Box(
                Modifier.padding(top = 2.dp).align(Alignment.CenterHorizontally).size(geo.cover)
                    .onGloballyPositioned { fold.stage = it.boundsInRoot() },
            ) {
                Box(Modifier.fillMaxSize().graphicsLayer {
                    val k = e(); val raw = fold.p.value
                    val a = fold.stage; val b = fold.mini
                    if ((k > 0f || raw < 0f) && a.width > 0f && b.width > 0f) {
                        transformOrigin = TransformOrigin(0f, 0f)
                        val s = 1f + (b.width / a.width - 1f) * k
                        scaleX = s; scaleY = s
                        translationX = (b.left - a.left) * k
                        translationY = (b.top - a.top) * k + (if (raw < 0f) raw * 160.dp.toPx() else 0f)
                    }
                    alpha = if (k > 0.9f) 1f - (k - 0.9f) / 0.1f else 1f       // the last steps: the bar's picture takes over
                }) {
                    Stage(
                        StageInput(p.queue, p.index, p.isPlaying, side, blocked, loading = p.buffering && !p.isPlaying), turn, geo.cover, light,
                        art = { vm.stageArt(it.trackId) },
                        folding = e,
                        onToggle = toggle,
                        onChange = { dir -> hint.hide(true); if (dir > 0) vm.next() else vm.previous() },
                        onFold = foldDrag,
                        back = { LyricsFace(ctx, sound, clock, p.isPlaying, accent, p.artUri, geo.cover, onAsk = { lines -> askFor = AskFor(quote = lines); sheet = PlayerSheet.Ask }, onFrom = { s -> vm.seek((s * 1000).toLong()); if (!p.isPlaying) vm.toggle() }, tip = hint) },
                        soundFace = { if (sound != null) SoundFace(sound, ui.stage, clock, accent, geo.cover, lineMoments(sound.moments), p.isPlaying, scaleKey, onPick = { scaleKey = it }, onPart = { at -> lit.at = at }) },
                        overlay = { HintPill(hint, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp)) },
                    )
                }
                BurstLayer(bursts, geo.cover, Modifier.align(Alignment.Center).requiredSize(geo.cover + 128.dp))
            }

            // the three sides
            Box(Modifier.fillMaxWidth().padding(top = geo.air + 17.dp).then(away), contentAlignment = Alignment.Center) {
                val sides = buildList { add(Side.Cover to "Обложка"); add(Side.Text to "Текст"); if (sound != null) add(Side.Sound to "Звук") }
                Segments(side, sides, { s -> if (s != side) { side = s; scaleKey = null; hint.hide(true); if (s == Side.Text) hint.tip("mx-lyrics-hint", "Коснись строчки — и спроси о ней") } }, compact = true)
            }

            // the title block
            Meta(ui, side, sound, scaleKey, geo.lines, accent, onArtist = { ctx?.track?.artists?.firstOrNull()?.id?.let(onArtist) }, onAlbum = { ctx?.track?.albumId?.let(onAlbum) },
                onMore = { sheet = PlayerSheet.About }, modifier = Modifier.padding(top = geo.air + 16.dp).padding(horizontal = 24.dp).then(away))

            Spacer(Modifier.weight(1f))

            Box(away) {
                SongLine(clock,(p.durationMs.takeIf { it > 0 } ?: ctx?.track?.durationMs ?: 0L) / 1000.0, sound?.sections.orEmpty(), sound?.let { lineMoments(it.moments) }.orEmpty(),
                    p.isPlaying, accent, lit, onScrub = { scrubbing = it }, onSeek = { s -> vm.seek((s * 1000).toLong()) }, modifier = Modifier.padding(horizontal = 24.dp))
            }
            Tray(p, onOpen = { sheet = PlayerSheet.Queue }, modifier = away)
            Actions(ui, vm, accent, bursts, side, onAsk = { askFor = AskFor(); sheet = PlayerSheet.Ask }, onAdd = { r -> addAnchor = r; adding = true }, added = added != null, modifier = away)
        }
        }
    }

    AboutSheet(sheet == PlayerSheet.About, ui, accent, onClose = { sheet = null }, onArtist = onArtist, onAsk = { q -> askFor = AskFor(ask = q); sheet = PlayerSheet.Ask })
    QueueSheet(sheet == PlayerSheet.Queue, ui, vm, accent, onClose = { sheet = null })
    AskSheet(sheet == PlayerSheet.Ask, ui, vm, askFor, accent, onClose = { sheet = null })
    val playlists by vm.allPlaylists.collectAsStateWithLifecycle(emptyList())
    AddMenu(adding, addAnchor, playlists, p.artUri, onPick = { pl, name ->
        adding = false
        vm.addTo(pl, name)
        val title = pl?.name ?: name.orEmpty()
        added = p.trackId to title
        haptics.perform(HapticCue.Confirm, fromUser = true)
        toasts?.show("Добавлено в «$title»")
    }, onClose = { adding = false })

    LaunchedEffect(Unit) { hint.firstVisit { if (side == Side.Cover && p.index < p.queue.lastIndex) turn.nudge(-1500f * density.density) } }
}

/** How the screen divides its height: the cover is as wide as the screen where there is room; the phrase
 *  keeps three lines where the screen is tall, two elsewhere; what is left over is air between the parts. */
internal data class Geometry(val cover: Dp, val lines: Int, val air: Dp)

internal fun geometry(w: Dp, h: Dp): Geometry {
    val full = w - 24.dp
    fun below(lines: Int) = (359 + lines * 22).dp
    val c3 = h - 50.dp - below(3)
    if (c3 >= full) return Geometry(full, 3, ((c3 - full) / 4).coerceAtMost(14.dp))
    val c2 = (h - 50.dp - below(2)).coerceAtMost(full).coerceAtLeast(220.dp)
    return Geometry(c2, 2, 0.dp)
}

@Composable
private fun TopBar(lossless: Boolean, sidePause: Boolean, playing: Boolean, onFold: () -> Unit, onToggle: () -> Unit, fold: FoldDrag, modifier: Modifier) {
    val c = MusixTheme.colors
    Box(
        modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp).pointerInput(Unit) {
            // the top bar is a handle too
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = true)
                val tracker = VelocityTracker()
                var on = false
                var y0 = 0f
                while (true) {
                    val ev = awaitPointerEvent()
                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                    tracker.addPosition(ch.uptimeMillis, ch.position)
                    if (!ch.pressed) { if (on) fold.release(tracker.calculateVelocity().y, false); break }
                    val dy = ch.position.y - down.position.y
                    if (!on) { if (kotlin.math.abs(dy) < 10.dp.toPx()) continue; on = true; y0 = dy; fold.grab() }
                    ch.consume()
                    fold.drag(dy - y0)
                }
            }
        },
    ) {
        RoundButton(MusixIcons.ChevronDown, "Свернуть плеер", onFold, Modifier.align(Alignment.CenterStart), filled = false)
        if (lossless) Text("Lossless", Modifier.align(Alignment.Center).border(1.dp, c.text.copy(alpha = 0.14f), RoundedCornerShape(7.dp)).padding(horizontal = 7.dp, vertical = 3.dp),
            style = MusixTheme.text.number.copy(fontFamily = MusixFontFamilies.Mono, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.02.em, color = c.textMuted))
        // on the words and the sound the stage is busy with its own taps: the pause moves up here
        val shown by animateFloatAsState(if (sidePause) 1f else 0f, springKcm(320f, 24f), label = "pp")
        val glyph by animateFloatAsState(if (playing) 1f else 0f, springKcm(520f, 26f), label = "ppg")
        if (shown > 0.01f) Box(
            Modifier.align(Alignment.CenterEnd).size(48.dp).graphicsLayer { alpha = shown.coerceIn(0f, 1f); val k = 0.6f + 0.4f * shown; scaleX = k; scaleY = k }
                .pressable(role = Press.Icon) { onToggle() },
            contentAlignment = Alignment.Center,
        ) { PlayPauseGlyph(glyph, Modifier.size(22.dp), c.text) }
    }
}
