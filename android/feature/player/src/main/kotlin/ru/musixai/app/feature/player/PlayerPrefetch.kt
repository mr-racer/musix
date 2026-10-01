package ru.musixai.app.feature.player

import android.content.Context
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import ru.musixai.app.core.data.PlayerRepository
import ru.musixai.app.core.player.PlayerController
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Warms what the player shows for the current track and the next two: the context (cover,
 * facts, lyrics), the cover at stage size, and the scrubber's envelope. A track change then
 * paints its real cover and its wave at once, not half a second later over the generated
 * placeholder (the owner, 2026-10-02). It runs from app start, so a closed player sheet
 * still opens warm.
 */
@Singleton
class PlayerPrefetch @Inject constructor(
    @ApplicationContext private val ctx: Context,
    private val player: PlayerController,
    private val repo: PlayerRepository,
) {
    private var started = false

    fun start(scope: CoroutineScope) {
        if (started) return
        started = true
        scope.launch {
            player.state.map { s -> listOfNotNull(s.trackId) + s.queue.drop(s.index + 1).take(2).map { it.trackId } }
                .distinctUntilChanged()
                .collectLatest { ids ->
                    for (id in ids) {
                        val c = runCatching { repo.context(id) }.getOrNull()
                        c?.image?.url(STAGE_PX)?.let { url -> SingletonImageLoader.get(ctx).enqueue(ImageRequest.Builder(ctx).data(url).build()) }
                        if (repo.cachedEnvelope(id) == null) runCatching { repo.envelope(id) }  // a 404 asks the server to compute it
                    }
                }
        }
    }

    companion object {
        /** The variant the cover stage asks for (a phone-wide square). */
        const val STAGE_PX = 1024
    }
}
