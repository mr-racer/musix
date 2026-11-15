package ru.musixai.app.feature.artist

import ru.musixai.app.core.designsystem.text
import android.os.Build
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.lerp
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.*
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.AsyncImage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import com.kyant.backdrop.backdrops.LayerBackdrop
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.ArtistRepository
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.CoverStack
import ru.musixai.app.core.designsystem.content.ProgressiveImage
import ru.musixai.app.core.designsystem.content.StackItem
import ru.musixai.app.core.designsystem.content.TrackRow
import ru.musixai.app.core.designsystem.control.GlassPlayButton
import ru.musixai.app.core.designsystem.gesture.HapticCue
import ru.musixai.app.core.designsystem.gesture.LocalMusixHaptics
import ru.musixai.app.core.designsystem.gesture.Press
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.motion.EnvelopeSprings
import ru.musixai.app.core.designsystem.motion.FlightKey
import ru.musixai.app.core.designsystem.motion.FlightKind
import ru.musixai.app.core.designsystem.motion.FlightSources
import ru.musixai.app.core.designsystem.motion.FlightSpot
import ru.musixai.app.core.designsystem.motion.LocalFlightSources
import ru.musixai.app.core.designsystem.motion.WordFlight
import ru.musixai.app.core.designsystem.motion.flightSpot
import ru.musixai.app.core.designsystem.motion.hinge
import ru.musixai.app.core.designsystem.motion.hingeShade
import ru.musixai.app.core.designsystem.motion.rememberFlightLocals
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.motion.springOf
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.HeadButton
import ru.musixai.app.core.designsystem.surface.HeadPlay
import ru.musixai.app.core.designsystem.surface.LocalToasts
import ru.musixai.app.core.designsystem.surface.ScrollHead
import ru.musixai.app.core.designsystem.surface.glassInk
import ru.musixai.app.core.designsystem.surface.glassSource
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.surface.rememberGlassSource
import ru.musixai.app.core.model.AlbumPage
import ru.musixai.app.core.model.ArtistPage
import ru.musixai.app.core.player.PlayerController
import ru.musixai.app.core.player.PlayerState
import javax.inject.Inject
import kotlin.math.roundToInt

/**
 * The album over the screens (the shell draws it above its routes, under the mini player): one
 * per app, opened from anywhere by [open]. The page behind steps back while it stands ([back]).
 */
@Stable
class AlbumHost {
    internal var request by mutableStateOf<AlbumRequest?>(null)
    private var seq = 0
    internal val backAnim = Animatable(0f)
    /** A pull at the leaf brings the page back under the finger. */
    internal var pullBack by mutableFloatStateOf(1f)

    /** An album is open (or closing): the shell's back goes to it. */
    var isOpen by mutableStateOf(false)
        internal set

    /** How far the page behind has stepped back: 0 = in front, 1 = the album stands over it. */
    val back: Float get() = backAnim.value * pullBack

    fun open(id: String) { request = AlbumRequest(id, ++seq) }

    internal var closeAsk by mutableIntStateOf(0)

    /** Closes it the usual way (a tab pressed under it). */
    fun close() { if (isOpen) closeAsk++ }
}

internal data class AlbumRequest(val id: String, val n: Int)

val LocalAlbums = staticCompositionLocalOf<AlbumHost?> { null }

@Composable
fun rememberAlbumHost(): AlbumHost = remember { AlbumHost() }

@HiltViewModel
class AlbumViewModel @Inject constructor(private val repo: ArtistRepository, private val player: PlayerController) : ViewModel() {
    private val _album = MutableStateFlow<AlbumPage?>(null)
    val album: StateFlow<AlbumPage?> = _album
    private val _artist = MutableStateFlow<ArtistPage?>(null)
    val artist: StateFlow<ArtistPage?> = _artist
    val error = MutableStateFlow(false)
    val offline = MutableStateFlow(false)
    val playerState: StateFlow<PlayerState> = player.state
    private var job: Job? = null

    fun load(id: String) {
        job?.cancel()
        error.value = false
        offline.value = false
        _album.value = repo.cachedAlbum(id)
        job = viewModelScope.launch {
            val a = runCatching { repo.album(id) }.getOrElse {
                if (_album.value == null) error.value = true else offline.value = true
                return@launch
            }
            _album.value = a
            // the artist comes along (its other albums for the stack, and the page ready in memory
            // when the listener goes to it: the album closes into its axis at once)
            val aid = a.artistId ?: return@launch
            _artist.value = repo.cached(aid)?.takeIf { it.artist.id == aid }
            if (_artist.value == null) _artist.value = runCatching { repo.page(aid) }.getOrNull()
        }
    }

    fun retry(id: String) = load(id)

    fun playing(s: PlayerState): Boolean = s.isPlaying && _album.value?.tracks?.any { it.id == s.trackId } == true

    fun playAlbum() {
        if (playing(player.state.value)) { player.toggle(); return }
        val a = _album.value ?: return
        player.playTracks(a.tracks.map { it.id }, 0, "album")
    }

    fun playAt(i: Int) { _album.value?.let { a -> player.playTracks(a.tracks.map { it.id }, i, "album") } }
    fun queue(trackId: String) = player.toggleNext(trackId)
}

/** How the album came: out of a picture, out of a word, or out of nowhere. */
private sealed interface Entry {
    data class Picture(val key: Any) : Entry
    data class Word(val key: Any) : Entry
    data object None : Entry
}

private data class LeafTitle(val id: String)

private fun smooth(x: Float): Float { val t = x.coerceIn(0f, 1f); return t * t * (3f - 2f * t) }

/**
 * The envelope's geometry and motion: the cover's place (its slot at rest, or flying, or pulled, or
 * dimmed by the scroll), the leaf's hinge, and whether the leaf rides with the cover. Everything here
 * is read in the draw phase.
 */
@Stable
private class Envelope {
    var origin = Offset.Zero        // the layer in root px
    var slot = Rect.Zero            // the cover's slot at rest, in the layer
    var height = 0f
    var c = 0f
    var r0 = 0f                     // the slot's radius (10 dp)
    var rs = 0f                     // a source cover's radius (8 dp)
    val fly = Animatable(1f)
    var from = Rect.Zero            // root
    var to: () -> Rect? = { null }  // root
    var flying by mutableStateOf(false)
    var closing by mutableStateOf(false)
    var h0 = 1f
    val hinge = Animatable(1f)
    var pull by mutableFloatStateOf(0f)
    var scroll: () -> Int = { 0 }
    val intro = Animatable(1f)
    val reveal = Animatable(1f)
    val fade = Animatable(1f)
    var sink by mutableFloatStateOf(0f)
    var source: FlightSpot? = null  // the picture that flew in, drawn under the cover until it loads
        private set

    /** Draws [s] under the cover, keeping its picture even if its page goes. */
    fun holdSource(s: FlightSpot?) { source?.drop(); source = s; s?.hold() }

    private fun q() = (pull / (height * 0.5f)).coerceIn(0f, 1f)
    private fun dim() = (scroll() / (c * 0.9f)).coerceIn(0f, 1f)

    /** The cover's rectangle in the layer. */
    fun cover(): Rect {
        if (flying) {
            val t = fly.value
            val a = from.translate(-origin)
            val b = to()?.translate(-origin) ?: a
            return lerp(a, b, t)
        }
        if (pull > 0.5f) {
            val s = 1f - 0.22f * q()
            val y = pull * 0.6f
            return Rect(Offset(slot.left + c * (1f - s) / 2f, slot.top + y), androidx.compose.ui.geometry.Size(c * s, c * s))
        }
        val s = 1f - 0.06f * dim()
        return Rect(Offset(slot.left + c * (1f - s) / 2f, slot.top), androidx.compose.ui.geometry.Size(c * s, c * s))
    }

    fun coverAlpha(): Float = if (flying || pull > 0.5f) 1f else 1f - 0.6f * dim()

    /** The cover's corner on screen: a source's 8 dp flying into the slot's 10 and back. */
    fun radius(): Float = if (flying) { val t = fly.value; if (closing) r0 + (rs - r0) * t else rs + (r0 - rs) * t } else r0

    /** How open the leaf is: on its own spring, folded by a pull, folded into the cover as it flies home. */
    fun leafOpen(): Float = when {
        closing -> h0 * (1f - smooth(fly.value / 0.8f))
        pull > 0.5f -> hinge.value * (1f - 0.62f * q())
        else -> hinge.value
    }

    /** The leaf's shift under a pulled cover (the mock's `drawPull`). */
    fun leafShift(): Float {
        if (pull <= 0.5f) return 0f
        val s = 1f - 0.22f * q()
        return pull * 0.6f - c * (1f - s)
    }

    fun pageBack(): Float = 1f - 0.85f * q()
}

private val Leave = CubicBezierEasing(0.4f, 0f, 1f, 1f)
private val Arrive = CubicBezierEasing(0.22f, 0.9f, 0.3f, 1f)

/**
 * «Конверт» — the album (2026-11-15 mock): the cover in its slot over a field of its own colour,
 * the leaf of matte glass under it on a hinge, the songs on the leaf. Out of a cover the cover
 * itself flies into the slot and the leaf unfolds under it; out of a title the word flies into the
 * heading. Going back, the cover flies home **with the leaf folding into it** — one envelope, the
 * leaf edge-on before the cover lands (the owner, 2026-11-15: the leaf «складывается, а потом
 * резко исчезает»). A pull at the top of the leaf folds it under the finger; Back scrubs the same.
 * The artist's name goes to the artist: the album closes into its place on the artist's axis.
 */
@Composable
fun AlbumLayer(host: AlbumHost, currentArtist: () -> String?, onArtist: (String) -> Unit, vm: AlbumViewModel = hiltViewModel()) {
    val req = host.request
    val sources = LocalFlightSources.current
    val reduced = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val haptics = LocalMusixHaptics.current
    val env = remember { Envelope() }
    val scroll = rememberScrollState()
    env.scroll = { scroll.value }
    var shown by remember { mutableStateOf<String?>(null) }
    var entry by remember { mutableStateOf<Entry>(Entry.None) }
    val locals = rememberFlightLocals()
    var closeJob by remember { mutableStateOf<Job?>(null) }

    fun finish() {
        val e = entry
        if (e is Entry.Picture) sources?.show(e.key)
        if (e is Entry.Word) sources?.show(e.key)
        shown?.let { sources?.show(LeafTitle(it)) }
        shown = null
        entry = Entry.None
        env.flying = false; env.closing = false; env.pull = 0f; env.sink = 0f; env.holdSource(null)
        host.pullBack = 1f
        host.isOpen = false
        scope.launch { env.fade.snapTo(1f); env.hinge.snapTo(1f); host.backAnim.snapTo(0f) }
    }

    /** Back into where it came from; [into] overrides the way (the artist's axis). */
    fun close(velocity: Float = 0f, into: Entry? = null, waitFor: FlightSpot? = null) {
        if (shown == null || env.closing) return
        val e = into ?: entry
        if (into != null) {
            val old = entry
            if (old is Entry.Picture && old.key != (into as? Entry.Picture)?.key) sources?.show(old.key)
            entry = into
            if (into is Entry.Picture) sources?.hide(into.key)
        }
        host.isOpen = false
        closeJob?.cancel()
        closeJob = scope.launch {
            if (reduced || sources == null || sources.still) { finish(); return@launch }
            when (e) {
                is Entry.Picture -> {
                    // the target may be a page still being composed (the artist's axis): a few frames
                    var spot: FlightSpot? = null
                    for (i in 0 until 10) {
                        spot = sources.spot(e.key)?.takeIf { it !== waitFor }
                        if (spot != null) break
                        withFrameNanos { }
                    }
                    val vis = spot?.visible()
                    val full = spot?.rect()
                    if (spot != null && vis != null && full != null && vis.height > full.height * 0.3f) {
                        env.from = env.cover().translate(env.origin)
                        env.to = { spot.rect() }
                        env.rs = spot.radius.takeIf { it > 0f } ?: with(density) { 8.dp.toPx() }
                        env.h0 = env.leafOpen()
                        env.closing = true
                        env.flying = true
                        env.fly.snapTo(0f)
                        launch { host.backAnim.animateTo(0f, EnvelopeSprings.flight()) }
                        env.fly.animateTo(1f, EnvelopeSprings.flight(), initialVelocity = (velocity / 900f).coerceAtLeast(0f))
                        finish()
                        return@launch
                    }
                    // the cover is not on screen: it sinks and fades
                    launch { host.backAnim.animateTo(0f, EnvelopeSprings.flight()) }
                    launch { animate(0f, 1f, animationSpec = tween(260, easing = Leave)) { v, _ -> env.sink = v } }
                    env.fade.animateTo(0f, tween(260, easing = Leave))
                    finish()
                }
                is Entry.Word -> {
                    val spot = sources.spot(e.key)
                    val title = sources.spot(LeafTitle(shown!!))
                    val from = title?.rect()
                    val vis = spot?.visible()
                    if (spot != null && title != null && from != null && vis != null) {
                        // the heading flies home and the word comes back under it: the flight shows
                        // it when it lands (not finish()), and holds the heading's picture after the leaf goes
                        entry = Entry.None
                        sources.hide(LeafTitle(shown!!))
                        sources.launch(locals) { done -> WordFlight(title, from, e.key, sources, done = done) }
                    }
                    launch { host.backAnim.animateTo(0f, EnvelopeSprings.flight()) }
                    env.fade.animateTo(0f, tween(260, easing = Leave))
                    finish()
                }
                Entry.None -> {
                    launch { host.backAnim.animateTo(0f, EnvelopeSprings.flight()) }
                    env.fade.animateTo(0f, tween(200))
                    finish()
                }
            }
        }
    }

    val asked = remember { intArrayOf(host.closeAsk) }
    LaunchedEffect(host.closeAsk) { if (host.closeAsk != asked[0]) { asked[0] = host.closeAsk; close() } }

    // open: out of the spot the finger came down on
    LaunchedEffect(req) {
        val r = req ?: return@LaunchedEffect
        if (shown == r.id && host.isOpen) return@LaunchedEffect
        closeJob?.cancel()
        if (shown != null) finish()
        vm.load(r.id)
        val s = sources
        val pic = s?.pressed(FlightKey.albumCover(r.id))
        val word = if (pic == null) s?.pressed(FlightKey.albumTitle(r.id)) else null
        entry = when { pic != null -> Entry.Picture(pic.key); word != null -> Entry.Word(word.key); else -> Entry.None }
        shown = r.id
        host.isOpen = true
        host.pullBack = 1f
        scroll.scrollTo(0)
        env.pull = 0f; env.sink = 0f; env.closing = false
        env.fade.snapTo(1f)
        // the layer is placed in the next frame: its slot is known after that
        var n = 0
        while (env.c == 0f && n++ < 10) withFrameNanos { }
        if (reduced || s == null || s.still || entry == Entry.None) {
            env.flying = false; env.hinge.snapTo(1f); env.reveal.snapTo(1f); env.intro.snapTo(1f)
            if (reduced) host.backAnim.snapTo(1f)
            else {
                launch { host.backAnim.animateTo(1f, EnvelopeSprings.flight()) }
                env.fade.snapTo(0f); env.fade.animateTo(1f, tween(200))
            }
            return@LaunchedEffect
        }
        if (pic != null) {
            // the picture that was touched travels: no copy of it, no blank frame
            val from = pic.rect() ?: return@LaunchedEffect
            env.holdSource(pic)
            env.rs = pic.radius.takeIf { it > 0f } ?: with(density) { 8.dp.toPx() }
            s.hide(pic.key)
            env.from = from
            env.to = { env.slot.translate(env.origin) }
            env.flying = true
            env.fly.snapTo(0f)
            env.hinge.snapTo(0f)
            env.reveal.snapTo(0f)
            env.intro.snapTo(1f)
            launch { host.backAnim.animateTo(1f, EnvelopeSprings.flight()) }
            launch { env.fly.animateTo(1f, EnvelopeSprings.flight()); env.flying = false }
            delay(260)
            launch { env.reveal.animateTo(1f, tween(380, easing = Arrive)) }
            env.hinge.animateTo(1f, EnvelopeSprings.hinge())
        } else if (word != null) {
            // a word: it flies into the heading; the cover comes out of the blur in its slot, the leaf is open
            env.flying = false
            env.hinge.snapTo(1f)
            env.intro.snapTo(0f); env.reveal.snapTo(0f)
            s.hide(word.key)
            val from = word.rect()
            launch { host.backAnim.animateTo(1f, EnvelopeSprings.flight()) }
            launch { env.intro.animateTo(1f, tween(460, easing = Arrive)) }
            launch { delay(60); env.reveal.animateTo(1f, tween(380, easing = Arrive)) }
            if (from != null) {
                // the heading is hidden at once; its place is measured once the leaf is laid out
                s.hide(LeafTitle(r.id))
                var t = 0
                while (s.spot(LeafTitle(r.id))?.rect() == null && t++ < 10) withFrameNanos { }
                s.launch(locals) { done -> WordFlight(word, from, LeafTitle(r.id), s, done = done) }
            }
        }
    }

    val id = shown ?: return
    val album by vm.album.collectAsStateWithLifecycle()
    val artist by vm.artist.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val offline by vm.offline.collectAsStateWithLifecycle()
    val ps by vm.playerState.collectAsStateWithLifecycle()
    val a = album?.takeIf { it.id == id }
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val src = rememberGlassSource()

    // a pull at the top of the leaf folds it back under the finger; past a fifth of the screen it closes
    val pullConn = remember {
        object : NestedScrollConnection {
            var past = false
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput || env.closing || env.pull <= 0f || available.y >= 0f) return Offset.Zero
                val nd = (env.pull + available.y).coerceAtLeast(0f)
                val used = nd - env.pull
                env.pull = nd
                host.pullBack = env.pageBack()
                return Offset(0f, used)
            }
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput || env.closing || available.y <= 0f) return Offset.Zero
                env.pull += available.y
                host.pullBack = env.pageBack()
                val over = env.pull > env.height * 0.2f
                if (over != past) { past = over; haptics.perform(if (over) HapticCue.Threshold else HapticCue.ThresholdOff, fromUser = true) }
                return Offset(0f, available.y)
            }
            override suspend fun onPreFling(available: Velocity): Velocity {
                if (env.pull <= 0f || env.closing) return Velocity.Zero
                // the flick's projection decides
                val projected = env.pull + available.y * 0.12f
                past = false
                if (projected > env.height * 0.2f) close(available.y)
                else animate(env.pull, 0f, available.y, springOf(0.32f)) { v, _ -> env.pull = v; host.pullBack = env.pageBack() }
                return available
            }
        }
    }

    PredictiveBackHandler(enabled = host.isOpen && !env.closing) { progress ->
        try {
            progress.collect { e -> env.pull = e.progress * env.height * 0.3f; host.pullBack = env.pageBack() }
            close()
        } catch (x: CancellationException) {
            scope.launch { animate(env.pull, 0f, 0f, springOf(0.32f)) { v, _ -> env.pull = v; host.pullBack = env.pageBack() } }
            throw x
        }
    }

    BoxWithConstraints(
        Modifier.fillMaxSize()
            .onGloballyPositioned { env.origin = it.positionInRoot() }
            .graphicsLayer {
                alpha = env.fade.value
                if (env.sink > 0f) translationY = 40.dp.toPx() * env.sink
            }
            .pointerBlock(),
    ) {
        val w = maxWidth
        val h = maxHeight
        val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 56.dp
        val cw = w - 32.dp
        val pad = pagePad(w)
        with(density) {
            env.c = cw.toPx(); env.height = h.toPx()
            env.slot = Rect(Offset(16.dp.toPx(), top.toPx()), androidx.compose.ui.geometry.Size(env.c, env.c))
            env.r0 = 10.dp.toPx()
        }
        val spacer = top + cw + 10.dp
        val spacerPx = with(density) { spacer.toPx() }
        // the picture the leaf's glass is made of: the field and the cover
        Box(Modifier.fillMaxSize().glassSource(src)) {
            // clipped: the field is scaled up 1.24 and its bare lower edge used to hang under the mini-player
            Box(Modifier.fillMaxSize().clipToBounds().graphicsLayer { alpha = host.back.coerceIn(0f, 1f) }.background(c.bg)) {
                Crossfade(a?.image?.bg ?: a?.image?.url(96), label = "field") { f ->
                    AsyncImage(f, null, Modifier.fillMaxSize().graphicsLayer { scaleX = 1.24f; scaleY = 1.24f }, contentScale = ContentScale.Crop)
                }
                // the field keeps its colour down to the bottom: the matte leaf shows it
                Box(Modifier.fillMaxSize().background(
                    if (dark) Brush.verticalGradient(0f to Color(0x330A0A0D), 0.45f to Color(0x800A0A0D), 1f to c.bg.copy(alpha = 0.78f))
                    else Brush.verticalGradient(0f to Color(0x52F2F1F6), 0.45f to Color(0xA8F2F1F6), 1f to c.bg.copy(alpha = 0.82f)),
                ))
            }
            Box(
                Modifier.offset(16.dp, top).size(cw).graphicsLayer {
                    val r = env.cover()
                    val s = r.width / env.c
                    transformOrigin = TransformOrigin(0f, 0f)
                    translationX = r.left - env.slot.left
                    translationY = r.top - env.slot.top
                    scaleX = s; scaleY = s
                    shape = RoundedCornerShape(CornerSize(env.radius() / s.coerceAtLeast(0.01f)))
                    clip = true
                    shadowElevation = 22.dp.toPx() * (if (env.flying) 1f else env.coverAlpha())
                    val i = env.intro.value
                    alpha = env.coverAlpha() * (0.4f + 0.6f * i)
                    if (i < 1f) {
                        val k = 0.96f + 0.04f * i
                        scaleX = s * k; scaleY = s * k
                        translationX += env.c * 0.02f * (1f - i); translationY += env.c * 0.02f * (1f - i)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) renderEffect = BlurEffect(8.dp.toPx() * (1f - i), 8.dp.toPx() * (1f - i))
                    }
                }.background(c.plate),
            ) {
                // the picture that flew in, under the cover until the cover itself is drawn
                val spot = env.source
                if (spot != null) Box(Modifier.fillMaxSize().drawWithContent {
                    val b = spot.picture.size
                    if (b.width > 0) { val k = size.width / b.width; scale(k, k, pivot = Offset.Zero) { drawLayer(spot.picture) } }
                })
                ProgressiveImage(a?.image?.url(256), a?.image?.url(1024), Modifier.fillMaxSize())
            }
        }
        // the leaf: it rides with the cover when it goes home, and folds on its hinge
        Box(Modifier.fillMaxSize().graphicsLayer {
            if (env.closing) {
                val r = env.cover()
                val s = r.width / env.c
                transformOrigin = TransformOrigin(0f, 0f)
                scaleX = s; scaleY = s
                translationX = r.left - s * env.slot.left
                translationY = r.top - s * env.slot.top + env.leafShift() * s
            } else translationY = env.leafShift()
        }) {
            Box(Modifier.fillMaxSize().graphicsLayer {
                val open = env.leafOpen()
                val leafTop = spacerPx - scroll.value
                hinge(open, pivotY = (leafTop / size.height).coerceIn(0f, 1f))
            }) {
                // the glass under the leaf: one screen tall, following the leaf's top (never a page-long blur);
                // it goes on under the mini-player, so its lower edge (and the lens there) stays under the tab bar;
                // unbounded: a plain height() is held to the layer's own, and the glass then ended 32 dp short
                Box(
                    Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = true).height(h + 40.dp + UnderBars).graphicsLayer {
                        translationY = (spacerPx - scroll.value).coerceAtLeast(-32.dp.toPx())
                    }.liquidGlass(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp), GlassTone.Deep, shadow = true, source = src)
                        .drawWithContent {
                            drawContent()
                            val sh = hingeShade(env.leafOpen())
                            if (sh > 0.001f) drawRect(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.42f), 0.6f to Color.Black.copy(alpha = 0.9f)), alpha = sh)
                        },
                )
                Column(Modifier.fillMaxSize().nestedScroll(pullConn).verticalScroll(scroll)) {
                    Spacer(Modifier.height(spacer))
                    Leaf(
                        id, a, artist, error, offline, ps, vm, pad, w,
                        reveal = { env.reveal.value },
                        minHeight = h - top,
                        glass = src,
                        onArtist = { aid ->
                            if (currentArtist() == aid) close()
                            else {
                                val key = FlightKey.albumCover(id)
                                val before = sources?.spot(key)
                                onArtist(aid)
                                close(into = Entry.Picture(key), waitFor = before)
                            }
                        },
                        onProducer = onArtist,
                        onSwap = { other, rect ->
                            // the picked cover flies from the stack into the slot; the leaf refills
                            val old = entry
                            if (old is Entry.Picture) sources?.show(old.key)
                            if (old is Entry.Word) sources?.show(old.key)
                            val key = FlightKey.albumCover(other)
                            entry = if (sources?.spot(key) != null) Entry.Picture(key).also { sources.hide(key) } else Entry.None
                            vm.load(other)
                            shown = other
                            env.holdSource(null)
                            scope.launch {
                                if (rect.width > 0f && !reduced) {
                                    env.from = rect; env.to = { env.slot.translate(env.origin) }; env.flying = true
                                    env.rs = with(density) { 8.dp.toPx() }
                                    env.fly.snapTo(0f)
                                    launch { scroll.animateScrollTo(0, springOf(0.45f)) }
                                    launch { env.reveal.snapTo(0f); env.reveal.animateTo(1f, tween(380, easing = Arrive)) }
                                    env.fly.animateTo(1f, EnvelopeSprings.flight()); env.flying = false
                                } else scroll.scrollTo(0)
                            }
                        },
                    )
                }
            }
        }
        // the head of matte glass once the cover has scrolled away; the round button to close
        val headOn by remember { derivedStateOf { scroll.value > with(density) { (cw - 40.dp).toPx() } } }
        ScrollHead(headOn && !env.closing, src, veil = c.bg) {
            AsyncImage(a?.image?.url(96), null, Modifier.size(34.dp).clip(RoundedCornerShape(7.dp)).background(c.plate), contentScale = ContentScale.Crop)
            Column(Modifier.weight(1f)) {
                Text(a?.title?.let { cleanTitle(it).first }.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = glassInk()))
                Text(a?.artist.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.text.caption.copy(fontSize = 12.sp, color = glassInk(soft = true)))
            }
            HeadPlay(vm.playing(ps), vm::playAlbum)
        }
        HeadButton(MusixIcons.ChevronDown, "Закрыть альбом", { close() }, source = src, onArt = !headOn)
    }
}

/** How far the leaf's glass reaches below the layer: under the mini-player, to the opaque tab bar. */
private val UnderBars = 120.dp

/** The layer takes every touch while it stands (the page behind is out of reach). */
private fun Modifier.pointerBlock(): Modifier = pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false) } }

@Composable
private fun Leaf(
    id: String, a: AlbumPage?, artist: ArtistPage?, error: Boolean, offline: Boolean, ps: PlayerState, vm: AlbumViewModel,
    pad: Dp, w: Dp, reveal: () -> Float, minHeight: Dp, glass: LayerBackdrop,
    onArtist: (String) -> Unit, onProducer: (String) -> Unit, onSwap: (String, Rect) -> Unit,
) {
    val c = MusixTheme.colors
    val toasts = LocalToasts.current
    Box(Modifier.fillMaxWidth().heightIn(min = minHeight)) {
        // the grabber
        Box(Modifier.align(Alignment.TopCenter).padding(top = 8.dp).size(34.dp, 4.dp).background(c.text.copy(alpha = 0.18f), RoundedCornerShape(2.dp)))
        Column(Modifier.fillMaxWidth().padding(start = pad, end = pad, top = 26.dp, bottom = 36.dp).graphicsLayer {
            val k = reveal()
            alpha = k
            translationY = (1f - k) * 18.dp.toPx()
        }) {
            if (a == null) {
                if (error) {
                    Text("Не получилось открыть альбом", style = MusixTheme.text.body.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                    Text("Проверь сеть — и попробуем ещё раз.", Modifier.padding(top = 6.dp), style = MusixTheme.text.reading.copy(fontSize = 14.sp, color = c.textMuted))
                    BigPill("Повторить", MusixIcons.Shuffle, { vm.retry(id) }, Modifier.padding(top = 16.dp).widthIn(min = 160.dp))
                } else {
                    ru.musixai.app.core.designsystem.content.Skel(Modifier.fillMaxWidth(0.7f).height(30.dp), 8.dp)
                    Spacer(Modifier.height(14.dp))
                    ru.musixai.app.core.designsystem.content.Skel(Modifier.size(140.dp, 16.dp), 8.dp)
                    Spacer(Modifier.height(24.dp))
                    repeat(8) { i -> ru.musixai.app.core.designsystem.content.Skel(Modifier.padding(vertical = 8.dp).fillMaxWidth((60 + (i * 37) % 35) / 100f).height(16.dp), 8.dp) }
                }
                return@Column
            }
            val (clean, ed) = cleanTitle(a.title)
            val tfs = (if (w < 380.dp) 26.sp else if (w < 420.dp) 28.sp else 30.sp).let { if (clean.length > 30) it * 0.8f else it }
            Text(
                buildAnnotatedString {
                    append(clean)
                    if (ed != null) withStyle(SpanStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.textMuted)) { append("  $ed") }
                },
                Modifier.flightSpot(LeafTitle(id), FlightKind.Word, text = tfs),
                style = MusixTheme.text.title.copy(fontSize = tfs, fontWeight = FontWeight.Bold, lineHeight = tfs * 1.08f, letterSpacing = (-0.025).em, color = c.text),
            )
            val aid = a.artistId
            val by = a.artist
            if (by != null) Row(
                Modifier.padding(top = 8.dp).then(if (aid != null) Modifier.pressable(role = Press.Chip) { onArtist(aid) } else Modifier),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // the name alone flies to the artist (not its chevron): the spot is on the text
                Text(by, if (aid != null) Modifier.flightSpot(FlightKey.artistName(aid), FlightKind.Word, text = 16.sp) else Modifier,
                    style = MusixTheme.text.body.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium, color = c.text))
                if (aid != null) Icon(MusixIcons.ChevronRight, null, Modifier.size(16.dp), tint = c.textSubtle)
            }
            // the year alone (the owner, 2026-11-15: the genre, the count of songs and the minutes only cluttered it)
            a.year?.let { Text("$it", Modifier.padding(top = 7.dp), style = MusixTheme.text.number.copy(fontSize = 13.sp, color = c.textSubtle)) }
            val on = vm.playing(ps)
            Row(Modifier.padding(top = 17.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                // clear glass reading the field under the leaf (the owner, 2026-11-15: no blue here either)
                GlassPlayButton(on, vm::playAlbum, glass, Modifier.widthIn(min = 146.dp), size = 48.dp,
                    label = if (on) "Пауза" else "Слушать", onArt = false, shadow = true)
                Text(lamp(a), Modifier.weight(1f), style = MusixTheme.text.reading.copy(fontSize = 13.5.sp, lineHeight = 19.sp, color = c.textMuted))
            }
            if (offline) Text("Нет сети — играют песни, сохранённые на телефоне", Modifier.padding(top = 14.dp), style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textSubtle))
            val unheard = a.tracks.count { (a.trackPlays[it.id] ?: 0) == 0 }
            Row(Modifier.padding(top = 28.dp, bottom = 4.dp), verticalAlignment = Alignment.Bottom) {
                Text("Песни", Modifier.weight(1f), style = MusixTheme.text.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.02).em, color = c.text))
                if (unheard > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(6.dp).background(c.accent, CircleShape))
                    Text("  $unheard ещё не слышал", style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textSubtle))
                } else Text("все услышаны", style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textSubtle))
            }
            val hot = hotOf(a)
            val discs = a.tracks.mapNotNull { it.discNo }.toSet().size > 1
            var disc = 0
            Column(Modifier.padding(start = 0.dp, end = 0.dp).offset(x = (-4).dp).fillMaxWidth()) {
                a.tracks.forEachIndexed { i, t ->
                    if (discs && (t.discNo ?: 1) != disc) {
                        disc = t.discNo ?: 1
                        Text("ДИСК $disc", Modifier.padding(top = 14.dp, bottom = 4.dp, start = 4.dp), style = MusixTheme.text.cap.copy(color = c.textSubtle))
                    }
                    val feat = t.artists.drop(1).joinToString(", ") { it.name }
                    TrackRow(
                        title = t.title, number = "${t.trackNo ?: (i + 1)}", duration = clock(t.durationMs), onClick = { vm.playAt(i) },
                        sub = if (feat.isNotEmpty()) "feat. $feat" else null, now = ps.trackId == t.id, playing = ps.isPlaying,
                        hot = hot == t.id, new = (a.trackPlays[t.id] ?: 0) == 0, queued = queuedAt(ps, t.id), onQueue = { vm.queue(t.id) },
                    )
                }
            }
            // the credits
            val rows = buildList {
                if (a.producers.isNotEmpty()) add("Продюсеры" to null)
                if (a.label != null) add("Лейбл" to a.label)
                if (a.year != null) add("Год" to a.year.toString())
            }
            if (rows.isNotEmpty()) Column(Modifier.padding(top = 28.dp).fillMaxWidth().drawBehind {
                drawLine(c.border, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
            }.padding(top = 22.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for ((k, v) in rows) Row {
                    Text(k, Modifier.width(110.dp), style = MusixTheme.text.caption.copy(fontSize = 13.sp, color = c.textSubtle))
                    if (v != null) Text(v, Modifier.weight(1f), style = MusixTheme.text.body.copy(fontSize = 15.sp, color = c.text))
                    else Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (p in a.producers) Text(p.name,
                            Modifier.pressable(role = Press.Chip) { p.artistId?.let(onProducer) ?: toasts?.show("Продюсер ${p.name}: его песни в библиотеке — позже") },
                            style = MusixTheme.text.body.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.text))
                    }
                }
            }
            // «Ещё у …»: the artist's other albums in a stack
            val others = artist?.takeIf { it.artist.id == aid }?.let { p -> p.ui().albums.filter { it.id != a.id } }.orEmpty()
            if (others.isNotEmpty()) {
                Text("Ещё у ${a.artist.orEmpty()}", Modifier.padding(top = 30.dp, bottom = 6.dp),
                    style = MusixTheme.text.title.copy(fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.02).em, color = c.text))
                CoverStack(others.map { StackItem(it.image?.url(256), it.clean, it.year?.toString()) }, onPick = { i, r -> onSwap(others[i].id, r) },
                    size = if (w > 400.dp) 96.dp else 84.dp)
                Text("Веди пальцем по стопке и отпусти на нужной", Modifier.padding(top = 8.dp), style = MusixTheme.text.caption.copy(fontSize = 12.5.sp, color = c.textSubtle))
            }
        }
    }
}
