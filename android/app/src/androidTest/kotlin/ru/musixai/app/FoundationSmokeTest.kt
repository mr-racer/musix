package ru.musixai.app

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.compose
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import ru.musixai.app.widget.NowPlayingWidget
import ru.musixai.app.widget.StreamWidget

/** The foundation must keep system entry points working, including before sign-in. */
@RunWith(AndroidJUnit4::class)
class FoundationSmokeTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun <T> onMain(block: () -> T): T = FutureTask(Callable(block)).also {
        Handler(Looper.getMainLooper()).post(it)
    }.get(15, TimeUnit.SECONDS)

    @Test fun androidAutoExposesItsSixRootsWithoutAnAccount() {
        val token = SessionToken(context, ComponentName(context, "ru.musixai.app.core.player.PlaybackService"))
        val browser = onMain { MediaBrowser.Builder(context, token).buildAsync() }.get(15, TimeUnit.SECONDS)
        try {
            val root = onMain { browser.getLibraryRoot(null) }.get(10, TimeUnit.SECONDS).value!!
            val children = onMain { browser.getChildren(root.mediaId, 0, 100, null) }.get(10, TimeUnit.SECONDS).value!!
            assertEquals(listOf("Поток", "Недавнее", "Плейлисты", "Альбомы", "Исполнители", "Вайбики"), children.map { it.mediaMetadata.title.toString() })
        } finally { onMain { browser.release() } }
    }

    @Test fun bothGlanceProvidersRenderAndInflateTheirRemoteViews() = runBlocking {
        val providers = AppWidgetManager.getInstance(context).installedProviders
            .filter { it.provider.packageName == context.packageName }.map { it.provider.className }
        assertTrue(providers.contains("ru.musixai.app.widget.NowPlayingWidgetReceiver"))
        assertTrue(providers.contains("ru.musixai.app.widget.StreamWidgetReceiver"))
        for ((widget, size, expected) in listOf(
            Triple(NowPlayingWidget(), DpSize(110.dp, 110.dp), "MusiX"),
            Triple(NowPlayingWidget(), DpSize(250.dp, 110.dp), "СЕЙЧАС ИГРАЕТ"),
            Triple(StreamWidget(), DpSize(110.dp, 110.dp), "Поток"),
        )) {
            val remote = withTimeout(15_000) { widget.compose(context, size = size) }
            val labels = onMain { texts(remote.apply(context, null)) }
            assertTrue("Missing $expected in $labels", expected in labels)
        }
    }

    private fun texts(view: View): List<String> = when (view) {
        is TextView -> listOf(view.text.toString())
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    }
}
