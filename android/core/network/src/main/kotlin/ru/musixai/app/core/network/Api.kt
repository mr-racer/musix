package ru.musixai.app.core.network

import app.musix.api.apis.IdentityApi
import app.musix.api.apis.ImportsApi
import app.musix.api.apis.KnowledgeApi
import app.musix.api.apis.LibraryApi
import app.musix.api.apis.ListeningApi
import app.musix.api.apis.MediaApi
import app.musix.api.apis.PlaylistsApi
import app.musix.api.apis.QuizApi
import app.musix.api.apis.ScreensApi
import app.musix.api.apis.SearchApi
import app.musix.api.apis.StreamApi
import app.musix.api.apis.SyncApi
import app.musix.api.apis.SystemApi
import app.musix.api.apis.AssistantApi
import app.musix.api.infrastructure.ClientException
import app.musix.api.infrastructure.ServerException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import ru.musixai.app.core.common.ApiError

/** The generated v2 client bound to the current server. The generated calls block, so
 *  [call] moves them to the IO dispatcher; API objects are cheap and made per call, so a
 *  server change on the login screen applies at once. */
class MusixApi(val client: OkHttpClient, private val sessions: SessionStore, private val io: CoroutineDispatcher) {
    val base: String get() = sessions.current.server.trimEnd('/')

    suspend fun <T> call(block: MusixApi.() -> T): T = withContext(io) {
        try {
            block()
        } catch (e: ClientException) {
            throw ApiError(e.statusCode, e.message ?: "HTTP ${e.statusCode}", e)
        } catch (e: ServerException) {
            throw ApiError(e.statusCode, e.message ?: "HTTP ${e.statusCode}", e)
        }
    }

    val identity get() = IdentityApi(base, client)
    val sync get() = SyncApi(base, client)
    val library get() = LibraryApi(base, client)
    val listening get() = ListeningApi(base, client)
    val media get() = MediaApi(base, client)
    val playlists get() = PlaylistsApi(base, client)
    val screens get() = ScreensApi(base, client)
    val search get() = SearchApi(base, client)
    val stream get() = StreamApi(base, client)
    val knowledge get() = KnowledgeApi(base, client)
    val quiz get() = QuizApi(base, client)
    val imports get() = ImportsApi(base, client)
    val assistant get() = AssistantApi(base, client)
    val system get() = SystemApi(base, client)
}
