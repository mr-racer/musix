package ru.musixai.app

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.Callable
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/** Android Auto's view of the app (phase 8 §2), through a MediaBrowser like the head unit's. */
@RunWith(AndroidJUnit4::class)
class AutoBrowseTest {
    private val main = Handler(Looper.getMainLooper())
    private fun <T> onMain(block: () -> T): T = FutureTask(Callable(block)).also { main.post(it) }.get(10, TimeUnit.SECONDS)

    @Test
    fun the_root_lists_the_six_nodes_and_a_picked_track_plays_its_whole_album() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val token = SessionToken(ctx, ComponentName(ctx, "ru.musixai.app.core.player.PlaybackService"))
        val browser = onMain { MediaBrowser.Builder(ctx, token).buildAsync() }.get(15, TimeUnit.SECONDS)
        try {
            fun kids(id: String) = onMain { browser.getChildren(id, 0, 100, null) }.get(10, TimeUnit.SECONDS).value!!
            val root = onMain { browser.getLibraryRoot(null) }.get(10, TimeUnit.SECONDS).value!!
            val nodes = kids(root.mediaId)
            assertEquals(listOf("Поток", "Недавнее", "Плейлисты", "Альбомы", "Исполнители", "Вайбики"), nodes.map { it.mediaMetadata.title.toString() })

            val albums = kids("musix.albums").take(5)
            assumeTrue("needs a signed-in account with music", albums.isNotEmpty())
            val tracks = albums.map { kids(it.mediaId) }.first { it.size >= 2 }
            onMain { browser.setMediaItem(tracks[1]); browser.prepare(); browser.play() }
            val deadline = System.currentTimeMillis() + 20_000
            while (!onMain { browser.isPlaying } && System.currentTimeMillis() < deadline) Thread.sleep(200)
            val (playing, count, current) = onMain { Triple(browser.isPlaying, browser.mediaItemCount, browser.currentMediaItem?.mediaId) }
            android.util.Log.i("AutoBrowseTest", "albums=${albums.size} tracks=${tracks.size} queued=$count current=$current playing=$playing")
            assertEquals(true, playing)
            assertEquals(tracks.size, count)  // the whole album, not the one track
            assertEquals(tracks[1].mediaId.removePrefix("t:").substringBefore('|'), current)
            onMain { browser.pause() }
        } finally {
            onMain { browser.release() }
        }
    }
}
