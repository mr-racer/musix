package ru.musixai.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import ru.musixai.app.MainActivity
import ru.musixai.app.R
import ru.musixai.app.core.player.NowPlaying
import ru.musixai.app.core.player.PlayerController

/*
 * The home screen widgets (phase 8 §3), in Glance:
 * - Now playing, 2×2 and 4×2: cover, titles, play/pause, next, огонёк.
 * - «Поток» one-tap: the orb starts the wave from the home screen.
 * They re-render only when NowPlaying changes (the service pushes it). Nothing polls.
 */

private val TEXT = ColorProvider(Color(0xFFEEEEF3))
private val MUTED = ColorProvider(Color(0x99EEEEF3))
private val FIRE = Color(0xFFFF7A18)

@EntryPoint
@InstallIn(SingletonComponent::class)
interface WidgetDeps {
    fun player(): PlayerController
}

private fun player(context: Context) = EntryPointAccessors.fromApplication(context.applicationContext, WidgetDeps::class.java).player()

class NowPlayingWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, WIDE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val s by NowPlaying.state.collectAsState()
            GlanceTheme { if (LocalSize.current.width >= WIDE.width) Wide(s) else Small(s) }
        }
    }

    companion object {
        val SMALL = DpSize(110.dp, 110.dp)
        val WIDE = DpSize(250.dp, 110.dp)
    }
}

@Composable
private fun Small(s: NowPlaying.Snapshot) {
    Box(GlanceModifier.fillMaxSize().cornerRadius(22.dp).background(ImageProvider(R.drawable.widget_bg)).clickable(actionStartActivity<MainActivity>())) {
        s.art?.let { Image(ImageProvider(it), null, GlanceModifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        Column(GlanceModifier.fillMaxSize().padding(12.dp).background(ColorProvider(Color(if (s.art != null) 0x80000000.toInt() else 0x00000000))), verticalAlignment = Alignment.Bottom) {
            Text(s.title.ifEmpty { "MusiX" }, style = TextStyle(color = TEXT, fontSize = 14.sp, fontWeight = FontWeight.Bold), maxLines = 1)
            Text(s.artist.ifEmpty { "Включить поток" }, style = TextStyle(color = MUTED, fontSize = 12.sp), maxLines = 1)
            Spacer(GlanceModifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(if (s.playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play, if (s.trackId == null) actionRunCallback<StreamAction>() else actionRunCallback<ToggleAction>(), big = true)
                Spacer(GlanceModifier.width(6.dp))
                if (s.trackId != null) Button(R.drawable.ic_widget_next, actionRunCallback<NextAction>())
            }
        }
    }
}

@Composable
private fun Wide(s: NowPlaying.Snapshot) {
    Row(GlanceModifier.fillMaxSize().cornerRadius(22.dp).background(ImageProvider(R.drawable.widget_bg)).padding(10.dp).clickable(actionStartActivity<MainActivity>()),
        verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.size(88.dp).cornerRadius(16.dp).background(ColorProvider(Color(0xFF26262D)))) {
            val art = s.art
            if (art != null) Image(ImageProvider(art), null, GlanceModifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else Image(ImageProvider(R.drawable.widget_orb), "Поток", GlanceModifier.fillMaxSize())
        }
        Spacer(GlanceModifier.width(12.dp))
        Column(GlanceModifier.defaultWeight().fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (s.stream) "ПОТОК" else "СЕЙЧАС ИГРАЕТ", style = TextStyle(color = MUTED, fontSize = 10.sp, fontWeight = FontWeight.Medium), maxLines = 1)
            Text(s.title.ifEmpty { "MusiX" }, style = TextStyle(color = TEXT, fontSize = 15.sp, fontWeight = FontWeight.Bold), maxLines = 1)
            Text(s.artist.ifEmpty { "Волна под твой вкус" }, style = TextStyle(color = MUTED, fontSize = 12.5.sp), maxLines = 1)
            Spacer(GlanceModifier.height(6.dp))
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (s.trackId != null) {
                    Button(R.drawable.ic_widget_fire, actionRunCallback<FireAction>(), tint = if (s.taste == "fire") FIRE else Color(0xCCEEEEF3))
                    Spacer(GlanceModifier.width(8.dp))
                }
                Button(if (s.playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play, if (s.trackId == null) actionRunCallback<StreamAction>() else actionRunCallback<ToggleAction>(), big = true)
                if (s.trackId != null) {
                    Spacer(GlanceModifier.width(8.dp))
                    Button(R.drawable.ic_widget_next, actionRunCallback<NextAction>())
                }
            }
        }
    }
}

@Composable
private fun Button(icon: Int, action: androidx.glance.action.Action, big: Boolean = false, tint: Color = Color(0xFFEEEEF3)) {
    val d = if (big) 40.dp else 34.dp
    Box(GlanceModifier.size(d).cornerRadius(d / 2).background(ColorProvider(if (big) Color(0xFF5874EA) else Color(0x1FFFFFFF))).clickable(action),
        contentAlignment = Alignment.Center) {
        Image(ImageProvider(icon), null, GlanceModifier.size(if (big) 18.dp else 16.dp), colorFilter = ColorFilter.tint(ColorProvider(if (big) Color.White else tint)))
    }
}

/** «Поток» in one tap: the orb, and the wave starts (no app screen opens). */
class StreamWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val s by NowPlaying.state.collectAsState()
            Column(GlanceModifier.fillMaxSize().cornerRadius(22.dp).background(ImageProvider(R.drawable.widget_bg)).padding(8.dp)
                .clickable(if (s.stream && s.trackId != null) actionRunCallback<ToggleAction>() else actionRunCallback<StreamAction>()),
                horizontalAlignment = Alignment.CenterHorizontally, verticalAlignment = Alignment.CenterVertically) {
                Box(GlanceModifier.size(56.dp), contentAlignment = Alignment.Center) {
                    Image(ImageProvider(R.drawable.widget_orb), null, GlanceModifier.fillMaxSize())
                    Image(ImageProvider(if (s.stream && s.playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play), "Поток", GlanceModifier.size(18.dp),
                        colorFilter = ColorFilter.tint(ColorProvider(Color.White)))
                }
                Spacer(GlanceModifier.height(4.dp))
                Text("Поток", style = TextStyle(color = TEXT, fontSize = 12.sp, fontWeight = FontWeight.Medium))
            }
        }
    }
}

class ToggleAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val p = player(context)
        if (p.ready()) kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { p.toggle() }
    }
}

class NextAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val p = player(context)
        if (p.ready()) kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { p.next() }
    }
}

class FireAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val p = player(context)
        if (p.ready()) kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { p.react("fire") }
    }
}

class StreamAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val p = player(context)
        if (p.ready()) kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { p.startStream() }
    }
}

class NowPlayingWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NowPlayingWidget()
}

class StreamWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = StreamWidget()
}
