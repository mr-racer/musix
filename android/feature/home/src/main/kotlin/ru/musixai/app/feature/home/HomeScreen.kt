package ru.musixai.app.feature.home

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.draw.innerShadow
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.musixai.app.core.designsystem.MusixFontFamilies
import ru.musixai.app.core.designsystem.MusixIcons
import ru.musixai.app.core.designsystem.MusixTheme
import ru.musixai.app.core.designsystem.component.BrandMark
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.RoundGlassButton
import ru.musixai.app.core.designsystem.component.Skel
import ru.musixai.app.core.designsystem.component.pressable
import ru.musixai.app.core.designsystem.hexColor
import ru.musixai.app.core.designsystem.oklch
import ru.musixai.app.core.model.Home
import ru.musixai.app.core.model.Vibe
import ru.musixai.app.core.player.QueueMode
import kotlinx.coroutines.delay
import java.text.NumberFormat
import java.util.Locale

@Composable
fun HomeRoute(onSearch: (String?) -> Unit, onSettings: () -> Unit, onLibrary: () -> Unit, vm: HomeViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    HomeScreen(ui, vm::orb, vm::playVibe, onSearch, onSettings, onLibrary)
}

private val BRAND_BLOBS = listOf(Color(0xFF7C5BFF), Color(0xFFFF78C8), Color(0xFFE0B341), Color(0xFFB06BFF))

/** v1 `LandingScreen` in its mobile «Эфир» form: the hero (vibe + orb + вайбики), the
 *  lyrics-search path and the library path, over an aurora in the taste palette. */
@Composable
fun HomeScreen(ui: HomeUi, orb: () -> Unit, playVibe: (Vibe) -> Unit, onSearch: (String?) -> Unit, onSettings: () -> Unit, onLibrary: () -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val home = ui.home
    // the aurora takes the covers of the top вайбики (the server palette) — v1 took taste axes + the top cover
    val blobs = remember(home) {
        val pals = home?.vibes?.mapNotNull { v -> v.tracks.firstOrNull()?.coverImageId?.let { home.images[it]?.palette } }.orEmpty()
        // v1's «dusty» bands: the hue from the covers, saturation and lightness held so a grey
        // cover still gives a readable orb (hsl(h, 36–60 %, 54–60 %), as axisPalette did)
        val cs = pals.flatMap { listOfNotNull(hexColor(it.vibrant), hexColor(it.dominant)) }.map { dusty(it, 58f) }
        if (cs.size >= 2) (cs + BRAND_BLOBS).take(4) else BRAND_BLOBS
    }
    Box(Modifier.fillMaxSize().background(
        if (dark) Brush.radialGradient(0f to Color(0xFF15151B), 0.6f to Color(0xFF0A0A0E), 1f to Color(0xFF07070A), center = Offset(540f, 0f), radius = 2400f)
        else Brush.radialGradient(0f to Color(0xFFFAFAFF), 0.6f to Color(0xFFECECF3), 1f to Color(0xFFE3E2E8), center = Offset(540f, 0f), radius = 2400f),
    )) {
        Aurora(blobs, if (dark) 0.34f else 0.24f)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding()) {
            Header(onSearch = { onSearch(null) }, onSettings = onSettings)
            Column(Modifier.padding(horizontal = 16.dp).padding(top = 2.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                val live = ui.player.mode == QueueMode.STREAM && ui.player.trackId != null
                // v1 `fy-loading`: the tap landed, the wave is still being built (until it plays, 12 s at most)
                var launching by remember { mutableStateOf(false) }
                LaunchedEffect(launching, live && ui.player.isPlaying) {
                    if (launching) { if (live && ui.player.isPlaying) launching = false else { delay(12_000); launching = false } }
                }
                val p = ui.player
                Hero(home, live, p.isPlaying, launching || (live && p.buffering && !p.isPlaying),
                    if (p.durationMs > 0) p.positionMs.toFloat() / p.durationMs else 0f, blobs,
                    { if (!live) launching = true; orb() }, playVibe)
                LyricsSearch(onSubmit = { onSearch(it) })
                LibraryCard(home, ui.tracks, onLibrary)
            }
        }
    }
}

@Composable
private fun Aurora(blobs: List<Color>, alpha: Float) {
    val t = rememberInfiniteTransition(label = "aurora")
    val drift by t.animateFloat(0f, 1f, infiniteRepeatable(tween(18_000), RepeatMode.Reverse), label = "drift")
    val c0 by animateColorAsState(blobs[0], tween(1600), label = "b0")
    val c1 by animateColorAsState(blobs[1], tween(1600), label = "b1")
    val c2 by animateColorAsState(blobs[2], tween(1600), label = "b2")
    val c3 by animateColorAsState(blobs[3], tween(1600), label = "b3")
    Canvas(Modifier.fillMaxWidth().height(560.dp).graphicsLayer { this.alpha = alpha }) {
        val w = size.width
        val h = size.height
        val fade = Brush.verticalGradient(0f to Color.Black, 0.4f to Color.Black, 1f to Color.Transparent)
        fun blob(color: Color, cx: Float, cy: Float, r: Float) =
            drawCircle(Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center = Offset(cx, cy), radius = r), r, Offset(cx, cy))
        blob(c0, w * (0.15f + 0.1f * drift), h * 0.25f, w * 0.75f)
        blob(c1, w * (0.85f - 0.1f * drift), h * 0.2f, w * 0.7f)
        blob(c2, w * 0.5f, h * (0.55f + 0.08f * drift), w * 0.65f)
        blob(c3, w * (0.3f + 0.2f * drift), h * 0.7f, w * 0.5f)
        drawRect(fade, blendMode = androidx.compose.ui.graphics.BlendMode.DstIn)
    }
}

@Composable
private fun Header(onSearch: () -> Unit, onSettings: () -> Unit) {
    val c = MusixTheme.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        BrandMark(42.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(buildAnnotatedString {
                append("Musi")
                withStyle(SpanStyle(fontStyle = FontStyle.Italic, color = oklch(62f, 0.2f, 275f))) { append("X") }
            }, style = MusixTheme.type.serif.copy(fontSize = 26.sp, lineHeight = 26.sp, letterSpacing = (-0.02).em, color = c.text))
        }
        RoundGlassButton(onSearch, size = 38.dp) { Icon(MusixIcons.Search, null, Modifier.size(16.dp), tint = c.textMuted) }
        Spacer(Modifier.width(12.dp))
        RoundGlassButton(onSettings, size = 38.dp) { Icon(MusixIcons.Settings, null, Modifier.size(17.dp), tint = c.textMuted) }
    }
}

@Composable
private fun Hero(home: Home?, streamLive: Boolean, playing: Boolean, loading: Boolean, progress: Float, blobs: List<Color>, orb: () -> Unit, playVibe: (Vibe) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val kicker = if (dark) Color(0xFFC9B8FF) else oklch(46f, 0.19f, 280f)
    Column(Modifier.padding(horizontal = 2.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            HeroEq()
            Spacer(Modifier.width(10.dp))
            Text("ТВОЙ ВАЙБ", style = MusixTheme.type.mono.copy(fontSize = 11.5.sp, letterSpacing = 0.28.em, color = kicker))
        }
        when {
            home == null -> Column(Modifier.padding(top = 16.dp)) {
                Skel(Modifier.fillMaxWidth(0.78f).height(28.dp)); Spacer(Modifier.height(10.dp)); Skel(Modifier.fillMaxWidth(0.52f).height(28.dp))
            }
            home.wavePhrase != null -> Text(home.wavePhrase!!, Modifier.padding(top = 12.dp),
                style = MusixTheme.type.title.copy(fontFamily = MusixFontFamilies.Playfair, fontWeight = FontWeight.Normal, fontSize = 22.sp, lineHeight = 1.28.em, color = c.text))
            else -> Column(Modifier.padding(top = 12.dp)) {
                Text("Начнём с разведки", style = MusixTheme.type.title.copy(fontWeight = FontWeight.Normal, fontSize = 22.sp, color = c.text))
                Text("Истории пока мало — поток начнёт с неизученных уголков библиотеки и подстроится под ваши реакции.",
                    Modifier.padding(top = 8.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, color = c.textMuted))
            }
        }
        Row(Modifier.padding(top = 18.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(84.dp), contentAlignment = Alignment.Center) { WaveOrb(blobs, playing && streamLive, loading, progress, orb) }
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f)) {
                Text(when { streamLive && playing -> "ВОЛНА ИГРАЕТ"; streamLive -> "ВОЛНА НА ПАУЗЕ"; else -> "ВКЛЮЧИТЬ ПОТОК" },
                    Modifier.pressable(onClick = orb), style = MusixTheme.type.mono.copy(fontSize = 13.sp, letterSpacing = 0.2.em, color = c.text))
                Text(when {
                    streamLive && playing -> "Нажмите, чтобы поставить волну на паузу"
                    streamLive -> "Нажмите, чтобы продолжить волну"
                    else -> "Волна под ваш вкус — подстраивается под реакции"
                }, Modifier.padding(top = 7.dp), style = MusixTheme.type.body.copy(fontSize = 13.sp, lineHeight = 1.45.em, color = c.textMuted))
                TunePill()
            }
        }
        val vibes = home?.vibes.orEmpty()
        if (vibes.isNotEmpty()) {
            Text(buildAnnotatedString {
                append("ВАЙБИКИ · ")
                withStyle(SpanStyle(letterSpacing = 0.08.em)) { append("то, что держит тебя сейчас") }
            }, Modifier.padding(top = 18.dp, bottom = 11.dp), style = MusixTheme.type.mono.copy(fontSize = 10.5.sp, letterSpacing = 0.2.em, color = c.textSubtle))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                for (v in vibes.take(3)) VibeChip(v, home!!, playVibe)
            }
        }
    }
}

/** `.hero-eq`: five bars in the kicker's colors, dancing. */
@Composable
private fun HeroEq() {
    val t = rememberInfiniteTransition(label = "eq")
    val phase by t.animateFloat(0f, 6.283f, infiniteRepeatable(tween(1400)), label = "p")
    Canvas(Modifier.size(width = 26.dp, height = 18.dp)) {
        val colors = listOf(Color(0xFF5B81FE), Color(0xFF858DFF), Color(0xFFAD99FB), Color(0xFFD08DAC), Color(0xFFDCA744))
        val bw = size.width / 8f
        colors.forEachIndexed { i, col ->
            val h = size.height * (0.35f + 0.65f * (0.5f + 0.5f * kotlin.math.sin(phase + i * 1.1f)))
            drawRoundRect(col, Offset(i * bw * 1.6f, size.height - h), androidx.compose.ui.geometry.Size(bw, h), androidx.compose.ui.geometry.CornerRadius(bw / 2))
        }
    }
}

@Composable
private fun TunePill() {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    var open by remember { mutableStateOf(false) }
    Row(
        Modifier.padding(top = 14.dp).clip(RoundedCornerShape(999.dp))
            .background(if (dark) Color(0x0AFFFFFF) else Color(0x08000000))
            .pressable { open = !open }.padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(MusixIcons.Settings, null, Modifier.size(14.dp), tint = c.textMuted)
        Text("НАСТРОИТЬ ВОЛНУ", style = MusixTheme.type.mono.copy(fontSize = 11.5.sp, letterSpacing = 0.16.em, color = c.textMuted))
        Icon(MusixIcons.ChevronDown, null, Modifier.size(12.dp).rotate(if (open) 180f else 0f), tint = c.textMuted)
    }
}

@Composable
private fun VibeChip(v: Vibe, home: Home, play: (Vibe) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val shape = RoundedCornerShape(999.dp)
    val first = v.tracks.firstOrNull()
    Row(
        Modifier.dropShadow(shape, Shadow(radius = 24.dp, color = if (dark) Color(0x66000000) else Color(0x1F3C2D64), offset = DpOffset(0.dp, 10.dp)))
            .clip(shape)
            .background(if (dark) Brush.linearGradient(listOf(Color(0x17FFFFFF), Color(0x08FFFFFF))) else Brush.linearGradient(listOf(Color(0xE6FFFFFF), Color(0x8CFFFFFF))))
            .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x1FFFFFFF) else Color(0xE6FFFFFF), offset = DpOffset(0.dp, 1.dp)))
            .pressable { play(v) }.padding(start = 9.dp, end = 14.dp, top = 9.dp, bottom = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Cover(first?.coverImageId?.let { home.images[it] }, first?.title.orEmpty(), first?.artist.orEmpty(), size = 26.dp, radius = 13.dp)
        Text(v.name ?: first?.genre ?: "Вайб", Modifier.widthIn(max = 170.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = MusixTheme.type.body.copy(fontSize = 12.5.sp, color = c.text))
        Text("▶", style = MusixTheme.type.body.copy(fontSize = 11.sp, color = c.text.copy(alpha = 0.55f)))
    }
}

@Composable
private fun LyricsSearch(onSubmit: (String) -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val kicker = if (dark) Color(0xFFC9B8FF) else oklch(46f, 0.19f, 280f)
    var q by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth()) {
        Text("✦ ПОИСК ПО ТЕКСТУ", Modifier.padding(bottom = 6.dp), style = MusixTheme.type.mono.copy(fontSize = 11.5.sp, letterSpacing = 0.24.em, color = kicker))
        Text("Помнишь строчку, а не название? ИИ найдёт песню по словам", Modifier.padding(bottom = 13.dp),
            style = MusixTheme.type.body.copy(fontSize = 13.5.sp, lineHeight = 1.45.em, color = c.textMuted))
        val shape = RoundedCornerShape(18.dp)
        Row(
            Modifier.fillMaxWidth().glassPath(shape).padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(MusixIcons.Search, null, Modifier.size(17.dp), tint = kicker)
            BasicTextField(q, { q = it }, Modifier.weight(1f), singleLine = true,
                textStyle = MusixTheme.type.body.copy(fontSize = 14.5.sp, color = c.text), cursorBrush = SolidColor(c.accentLight),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { if (q.isNotBlank()) onSubmit(q.trim()) }),
                decorationBox = { inner -> Box { if (q.isEmpty()) Text("строчка из песни…", style = MusixTheme.type.body.copy(fontSize = 14.5.sp, color = c.textSubtle)); inner() } })
            Text("ИИ", Modifier.border(1.dp, Color(0x669A7BFF), RoundedCornerShape(6.dp)).pressable { if (q.isNotBlank()) onSubmit(q.trim()) }
                .padding(horizontal = 7.dp, vertical = 3.dp), style = MusixTheme.type.mono.copy(fontSize = 9.sp, letterSpacing = 0.1.em, color = Color(0xFF9A7BFF)))
        }
    }
}

@Composable
private fun LibraryCard(home: Home?, tracks: Int, onClick: () -> Unit) {
    val c = MusixTheme.colors
    val dark = MusixTheme.isDark
    val kicker = if (dark) Color(0xFFC9B8FF) else oklch(46f, 0.19f, 280f)
    val fmt = NumberFormat.getIntegerInstance(Locale.US)
    val covers = home?.recentlyAdded.orEmpty().distinctBy { it.albumId ?: it.id }.take(3)
    Column(Modifier.fillMaxWidth()) {
        Text("◉ ФОНОТЕКА", Modifier.padding(bottom = 13.dp), style = MusixTheme.type.mono.copy(fontSize = 11.5.sp, letterSpacing = 0.24.em, color = kicker))
        val shape = RoundedCornerShape(18.dp)
        Box(Modifier.fillMaxWidth().height(96.dp).glassPath(shape).pressable(onClick = onClick)) {
            // the fan of three album covers, tilted, bleeding off the right edge (.efir-lib-fan)
            val tilts = listOf(-8f, -2f, 6f)
            covers.forEachIndexed { i, t ->
                Box(Modifier.align(Alignment.CenterEnd).offset(x = (-110 + i * 52).dp, y = 4.dp).rotate(tilts[i])) {
                    Cover(t.coverImageId?.let { home?.images?.get(it) }, t.album ?: t.title, t.artist, size = 88.dp, radius = 10.dp)
                }
            }
            Column(Modifier.align(Alignment.CenterStart).padding(horizontal = 20.dp)) {
                Text(buildAnnotatedString { append("Библиотека "); withStyle(SpanStyle(color = c.textMuted)) { append("→") } },
                    style = MusixTheme.type.body.copy(fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = c.text))
                val albums = home?.counts?.albums
                val n = home?.counts?.tracks ?: tracks
                Text(if (albums != null) "${fmt.format(albums)} АЛЬБОМОВ · ${fmt.format(n)} ТРЕКОВ" else "ОТКРЫТЬ ФОНОТЕКУ", Modifier.padding(top = 7.dp),
                    style = MusixTheme.type.mono.copy(fontSize = 10.5.sp, letterSpacing = 0.08.em, color = c.textMuted))
            }
        }
    }
}

/** The borderless paths' glass (lyrics search, library card). */
@Composable
private fun Modifier.glassPath(shape: androidx.compose.ui.graphics.Shape): Modifier {
    val dark = MusixTheme.isDark
    val c = MusixTheme.colors
    return this.dropShadow(shape, Shadow(radius = 44.dp, color = if (dark) Color(0x6B000000) else Color(0x1F3C2D64), offset = DpOffset(0.dp, 18.dp)))
        .clip(shape)
        .background(if (dark) Brush.linearGradient(listOf(Color(0x8C262236), Color(0x7312111A))) else Brush.linearGradient(listOf(Color(0xD9FFFFFF), Color(0x99F5F4FA))))
        .innerShadow(shape, Shadow(radius = 0.dp, color = if (dark) Color(0x17FFFFFF) else Color(0xE6FFFFFF), offset = DpOffset(0.dp, 1.dp)))
        .border(1.dp, c.border, shape)
}

private fun dusty(c: Color, lightness: Float): Color {
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(android.graphics.Color.rgb((c.red * 255).toInt(), (c.green * 255).toInt(), (c.blue * 255).toInt()), hsv)
    return Color.hsl(hsv[0], hsv[1].coerceIn(0.36f, 0.6f), lightness / 100f)
}
