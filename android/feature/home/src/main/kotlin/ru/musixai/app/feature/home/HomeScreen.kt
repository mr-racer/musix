package ru.musixai.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.offset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.content.Cover
import ru.musixai.app.core.designsystem.surface.GlassScene
import ru.musixai.app.core.designsystem.surface.GlassTone
import ru.musixai.app.core.designsystem.surface.liquidGlass
import ru.musixai.app.core.designsystem.motion.LocalCoverFlight
import ru.musixai.app.core.designsystem.LocalStageHeight
import ru.musixai.app.core.designsystem.motion.coverSource
import ru.musixai.app.core.designsystem.motion.rememberCoverSource
import ru.musixai.app.core.designsystem.stageTall
import ru.musixai.app.core.designsystem.motion.rememberReducedMotion
import ru.musixai.app.core.designsystem.content.Skel
import ru.musixai.app.core.designsystem.gesture.pressable
import ru.musixai.app.core.designsystem.hexColor
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.Home
import ru.musixai.app.core.model.Vibe
import ru.musixai.app.core.model.WavePreset
import ru.musixai.app.core.model.Weather
import ru.musixai.app.core.player.QueueMode
import kotlin.math.roundToInt
import ru.musixai.app.core.designsystem.bleed
import ru.musixai.app.core.designsystem.surface.MorphFrom
import ru.musixai.app.core.designsystem.surface.MorphMenu
import ru.musixai.app.core.designsystem.surface.rememberMorph

@Composable
fun HomeRoute(onSearch: (String?) -> Unit, onSettings: () -> Unit, onLibrary: () -> Unit, onAlbum: (String) -> Unit = {}, vm: HomeViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    HomeScreen(ui, HomeActions(
        orb = vm::orb, vibe = vm::playVibe, search = onSearch, settings = onSettings, library = onLibrary, album = onAlbum,
        listen = vm::albumDay, tune = vm::toggleTune, closeTune = vm::closeTune, pick = { vm.pick(it) }, reset = vm::resetTune,
    ))
}

/** What the home's controls do (the route wires them to the view model and the navigation). */
@Immutable
class HomeActions(
    val orb: () -> Unit = {}, val vibe: (Vibe) -> Unit = {}, val search: (String?) -> Unit = {}, val settings: () -> Unit = {},
    val library: () -> Unit = {}, val album: (String) -> Unit = {}, val listen: () -> Unit = {}, val tune: () -> Unit = {},
    val closeTune: () -> Unit = {}, val pick: (WavePreset) -> Unit = {}, val reset: () -> Unit = {},
)

private val BRAND_BLOBS = listOf(Color(0xFF7C5BFF), Color(0xFFFF78C8), Color(0xFFE0B341), Color(0xFFB06BFF))

/**
 * The phone's home, r3 «Сцена» (2026-11-13): one screen, no scrolling — the header, the
 * vibe phrase, the hero (the membrane orb, «Поток», the «Моя волна» capsule), the вайбики
 * and the album of the day as a ticket. The hero is the only flexible block: the free height
 * flows into it, so the ticket always sits 12 dp above the mini-player. The page height picks
 * the hero's form (a compact row / a row / a centred column, [heroSpec]).
 * The tuner and the search open as morphing panels from their anchors ([MorphMenu]).
 */
@Composable
fun HomeScreen(ui: HomeUi, a: HomeActions) {
    val home = ui.home
    val reduced = rememberReducedMotion()
    val blobs = remember(home) {
        val pals = home?.vibes?.mapNotNull { v -> v.tracks.firstOrNull()?.coverImageId?.let { home.images[it]?.palette } }.orEmpty()
        val cs = pals.flatMap { listOfNotNull(hexColor(it.vibrant), hexColor(it.dominant)) }.map { dusty(it, 58f) }
        if (cs.size >= 2) (cs + BRAND_BLOBS).take(4) else BRAND_BLOBS
    }
    val wave = remember { SkyWave() }
    var origin by remember { mutableStateOf(Offset.Zero) }
    var capsule by remember { mutableStateOf<Rect?>(null) }
    var searchAt by remember { mutableStateOf<Rect?>(null) }
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    val tuneMorph = rememberMorph(ui.tune.open, reduced)
    val searchMorph = rememberMorph(searchOpen, reduced)
    GlassScene(Modifier.fillMaxSize().onGloballyPositioned { origin = it.boundsInRoot().topLeft }, background = { Sky(blobs, wave, reduced, Modifier.stageTall(LocalStageHeight.current)) }) {
        BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding()) {
            val spec = heroSpec(maxHeight.value)
            val gap = when (spec.form) { HeroForm.Compact -> 6.dp; HeroForm.Row -> 10.dp; HeroForm.Column -> 12.dp }
            Column(Modifier.fillMaxSize().padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(gap)) {
                Header(home, searchAlpha = { searchMorph.anchorAlpha }, onSearchAt = { searchAt = it }, onSearch = { searchOpen = true }, a)
                VibePhrase(home, spec.form)
                Hero(ui, spec, blobs, reduced, wave, capsuleAlpha = { tuneMorph.anchorAlpha }, onCapsuleAt = { capsule = it }, a, Modifier.weight(1f).testTag("home-hero"))
                Vibes(home, a.vibe)
                home?.dayAlbum?.let { d ->
                    val p = ui.player
                    val ids = remember(d) { d.tracks.map { it.id }.toSet() }
                    val playingAlbum = p.mode == QueueMode.LIST && p.trackId in ids
                    AlbumTicket(
                        d, d.coverImageId?.let { home.images[it] }, dense = spec.form == HeroForm.Compact, extraHeard = ui.heard,
                        albumPlaying = playingAlbum, isPlaying = p.isPlaying, currentTrackId = p.trackId, reduced = reduced,
                        onListen = a.listen, onOpen = { a.album(d.albumId) }, modifier = Modifier.testTag("home-ticket"),
                    )
                }
            }
        }
        // the capsule itself grows into the tuner, its glass edge and all (the owner, 2026-11-15)
        MorphMenu(tuneMorph, capsule?.translate(-origin), a.closeTune, radiusFrom = 20.dp, scrim = 0.28f, glass = GlassTone.Deep,
            from = MorphFrom(glass = GlassTone.Chip, shadow = true, face = { CapsuleFace(ui.tune) })) {
            TunerPanel(ui.tune, a.pick, a.reset, a.closeTune)
        }
        MorphMenu(searchMorph, searchAt?.translate(-origin), { searchOpen = false }, radiusFrom = 20.dp, scrim = 0.4f) {
            SearchPanel(onSubmit = { q -> searchOpen = false; a.search(q) }, onAll = { searchOpen = false; a.search(null) })
        }
    }
}

/** «MusiX  +4° · ясно      [▤] (⌕) (⚙)»: the library stack, the search, the settings, 48 each. */
@Composable
private fun Header(home: Home?, searchAlpha: () -> Float, onSearchAt: (Rect) -> Unit, onSearch: () -> Unit, a: HomeActions) {
    val c = MusixTheme.colors
    Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(buildAnnotatedString {
            append("Musi")
            withStyle(SpanStyle(color = oklch(62f, 0.2f, 275f))) { append("X") }
        }, style = MusixTheme.type.body.copy(fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.02).em, color = c.text))
        // the weather takes what the buttons leave and ellipsizes on a narrow phone
        Box(Modifier.weight(1f).padding(start = 10.dp)) {
            home?.weather?.let { Text(weatherLine(it), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted)) }
        }
        LibraryStack(home, a.library)
        Box(Modifier.size(48.dp).pressable(onClick = onSearch).semantics { contentDescription = "Поиск" }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(40.dp).onGloballyPositioned { onSearchAt(it.boundsInRoot()) }.graphicsLayer { alpha = searchAlpha() },
                contentAlignment = Alignment.Center) { Icon(MusixIcons.Search, null, Modifier.size(18.dp), tint = c.textMuted) }
        }
        Box(Modifier.size(48.dp).pressable(onClick = a.settings).semantics { contentDescription = "Настройки" }, contentAlignment = Alignment.Center) {
            Icon(MusixIcons.Settings, null, Modifier.size(19.dp), tint = c.textMuted)
        }
    }
}

internal fun weatherLine(w: Weather): String {
    val kind = when (w.kind) { "clear" -> "ясно"; "cloudy" -> "облачно"; "rain" -> "дождь"; "snow" -> "снег"; else -> null }
    val t = w.temperatureC?.roundToInt()?.let { if (it > 0) "+$it°" else if (it < 0) "−${-it}°" else "0°" }
    return listOfNotNull(t, kind).joinToString(" · ")
}

/** Three fresh covers fanned at 32 dp: the way to the library. */
@Composable
private fun LibraryStack(home: Home?, onClick: () -> Unit) {
    val covers = home?.recentlyAdded.orEmpty().distinctBy { it.albumId ?: it.id }.take(3)
    Box(Modifier.size(48.dp).pressable(onClick = onClick).semantics { contentDescription = "Библиотека" }, contentAlignment = Alignment.Center) {
        val tilt = listOf(-9f, 0f, 9f)
        covers.forEachIndexed { i, t ->
            Box(Modifier.offset(x = ((i - 1) * 5).dp).rotate(tilt[i])) {
                Cover(t.coverImageId?.let { home?.images?.get(it) }, t.album ?: t.title, t.artist, size = 28.dp, radius = 6.dp)
            }
        }
        if (covers.isEmpty()) Icon(MusixIcons.Library, null, Modifier.size(19.dp), tint = MusixTheme.colors.textMuted)
    }
}

@Composable
private fun VibePhrase(home: Home?, form: HeroForm) {
    val c = MusixTheme.colors
    Column {
        if (form != HeroForm.Compact) Text("Твой вайб", style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
        // the phrase shows whole: a size steps down before an ellipsis cuts it (a tall page
        // also has a third line); only a phrase too long for the smallest size is cut
        val sizes = when (form) { HeroForm.Compact -> listOf(22.sp, 20.sp); HeroForm.Row -> listOf(24.sp, 22.sp); HeroForm.Column -> listOf(27.sp, 24.sp, 22.sp) }
        val lines = if (form == HeroForm.Column) 3 else 2
        val base = MusixTheme.type.body.copy(fontWeight = FontWeight.SemiBold, lineHeight = 1.18.em, letterSpacing = (-0.01).em, color = c.text)
        when {
            home == null -> Column(Modifier.padding(top = 6.dp)) {
                Skel(Modifier.fillMaxWidth(0.78f).height(24.dp)); Spacer(Modifier.height(8.dp)); Skel(Modifier.fillMaxWidth(0.5f).height(24.dp))
            }
            else -> BoxWithConstraints(Modifier.fillMaxWidth()) {
                val text = home.wavePhrase ?: "Начнём с разведки"
                val measurer = rememberTextMeasurer()
                val width = constraints.maxWidth
                val size = remember(text, width, form, base) {
                    sizes.firstOrNull { s ->
                        !measurer.measure(text, base.copy(fontSize = s), maxLines = lines, constraints = Constraints(maxWidth = width)).hasVisualOverflow
                    } ?: sizes.last()
                }
                Text(text, Modifier.testTag("home-phrase"), maxLines = lines, overflow = TextOverflow.Ellipsis, style = base.copy(fontSize = size))
            }
        }
    }
}

/** The orb, «Поток» and the capsule — a row, or a centred column on a tall page. */
@Composable
private fun Hero(ui: HomeUi, spec: HeroSpec, blobs: List<Color>, reduced: Boolean, wave: SkyWave, capsuleAlpha: () -> Float, onCapsuleAt: (Rect) -> Unit, a: HomeActions, modifier: Modifier) {
    val c = MusixTheme.colors
    val p = ui.player
    val live = p.mode == QueueMode.STREAM && p.trackId != null
    // the tap landed, the wave is still being built: a spinner until it plays (12 s at most)
    var launching by remember { mutableStateOf(false) }
    LaunchedEffect(launching, live && p.isPlaying) {
        if (launching) { if (live && p.isPlaying) launching = false else { delay(12_000); launching = false } }
    }
    val loading = launching || (live && p.buffering && !p.isPlaying)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val l = heroLayout(spec, maxHeight.value)
        val orb = l.orb.dp
        val title = when { live && p.isPlaying -> "Поток играет"; live -> "Поток на паузе"; else -> "Включить Поток" }
        val orbView = @Composable {
            Box(Modifier.size(orb).testTag("home-orb"), contentAlignment = Alignment.Center) {
                MembraneOrb(orb, blobs, playing = live && p.isPlaying, loading = loading,
                    progress = if (p.durationMs > 0) p.positionMs.toFloat() / p.durationMs else 0f, reduced = reduced,
                    onTap = { if (!live) launching = true; a.orb() }, onLaunch = { wave.fire(it) })
            }
        }
        val titleView = @Composable {
            Text(title, maxLines = 1, style = MusixTheme.type.body.copy(fontSize = if (spec.form == HeroForm.Compact) 18.sp else 20.sp, fontWeight = FontWeight.Medium, color = c.text))
        }
        val capsuleView = @Composable {
            WaveCapsule(ui.tune, enabled = true, hidden = false, onOpen = a.tune, Modifier.graphicsLayer { alpha = capsuleAlpha() }.testTag("home-capsule").onGloballyPositioned {
                // the visible 40 dp capsule inside the 48 dp target
                val b = it.boundsInRoot()
                val inset = (b.height - b.height * 40f / 48f) / 2f
                onCapsuleAt(Rect(b.left, b.top + inset, b.right, b.bottom - inset))
            })
        }
        if (l.column) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                orbView()
                Spacer(Modifier.height(14.dp))
                titleView()
                Spacer(Modifier.height(12.dp))  // 16 to the capsule's glass: its target adds 4
                capsuleView()
            }
        } else {
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                orbView()
                Spacer(Modifier.width(18.dp))
                Column {
                    titleView()
                    Spacer(Modifier.height(6.dp))  // 10 to the glass
                    capsuleView()
                }
            }
        }
    }
}

/** One row of chips, 48 high: a stack of two or three covers and the name. The only
 *  sideways scroll on the screen. */
@Composable
private fun Vibes(home: Home?, play: (Vibe) -> Unit) {
    val vibes = home?.vibes.orEmpty()
    if (vibes.isEmpty()) return
    Box(Modifier.fillMaxWidth().testTag("home-vibes").bleed(16.dp)) {
        Row(Modifier.fillMaxWidth().testTag("home-vibes-scroll").horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (v in vibes.take(6)) VibeChip(v, home!!, play)
        }
    }
}

@Composable
private fun VibeChip(v: Vibe, home: Home, play: (Vibe) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val shape = RoundedCornerShape(999.dp)
    val covers = v.tracks.distinctBy { it.albumId ?: it.id }.take(3)
    val flight = LocalCoverFlight.current
    val firstSrc = rememberCoverSource()
    Row(
        // clear glass (the owner, 2026-11-15): a button, nothing to read but its name
        Modifier.height(48.dp)
            .liquidGlass(shape, GlassTone.Chip)
            .clip(shape)
            .pressable {
                // the first song's cover flies to the mini-player: it is the one the bar will show
                if (covers.isNotEmpty()) flight?.launch(firstSrc, 8.dp)
                play(v)
            }.padding(start = 8.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width((32 + (covers.size - 1).coerceAtLeast(0) * 12).dp).height(32.dp)) {
            covers.forEachIndexed { i, t ->
                val src = if (i == 0) Modifier.coverSource(firstSrc).testTag("vibe-cover-${v.id}") else Modifier
                Cover(t.coverImageId?.let { home.images[it] }, t.title, t.artist, Modifier.offset(x = (i * 12).dp).then(src), size = 32.dp, radius = 8.dp)
            }
        }
        Text(v.name ?: covers.firstOrNull()?.genre ?: "Вайб", Modifier.padding(start = 10.dp).widthIn(max = 170.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MusixTheme.type.body.copy(fontSize = 14.sp, color = c.text))
    }
}

/** The search the round button flows into: a line, «Найти», the way to the full search. */
@Composable
private fun SearchPanel(onSubmit: (String) -> Unit, onAll: () -> Unit) {
    val c = MusixTheme.colors
    var q by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(140); runCatching { focus.requestFocus() } }
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 10.dp)) {
        Row(Modifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(MusixIcons.Search, null, Modifier.size(18.dp), tint = c.accentLight)
            BasicTextField(q, { q = it }, Modifier.weight(1f).padding(start = 12.dp).focusRequester(focus), singleLine = true,
                textStyle = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.text), cursorBrush = SolidColor(c.accentLight),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { if (q.isNotBlank()) onSubmit(q.trim()) }),
                decorationBox = { inner -> Box { if (q.isEmpty()) Text("Песня, артист или строчка…", style = MusixTheme.type.body.copy(fontSize = 15.sp, color = c.textSubtle)); inner() } })
            if (q.isNotBlank()) Box(Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).pressable { onSubmit(q.trim()) }.padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                Text("Найти", style = MusixTheme.type.body.copy(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.accentLight))
            }
        }
        Text("Помнишь строчку, а не название? ИИ найдёт песню по словам", Modifier.padding(top = 2.dp, end = 8.dp),
            style = MusixTheme.type.body.copy(fontSize = 13.sp, lineHeight = 1.35.em, color = c.textMuted))
        Box(Modifier.heightIn(min = 48.dp).pressable(onClick = onAll), contentAlignment = Alignment.CenterStart) {
            Text("Весь поиск →", style = MusixTheme.type.body.copy(fontSize = 13.5.sp, fontWeight = FontWeight.Medium, color = c.accentLight))
        }
    }
}

private fun dusty(c: Color, lightness: Float): Color {
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(android.graphics.Color.rgb((c.red * 255).toInt(), (c.green * 255).toInt(), (c.blue * 255).toInt()), hsv)
    return Color.hsl(hsv[0], hsv[1].coerceIn(0.36f, 0.6f), lightness / 100f)
}


