package ru.musixai.app.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class TokenAuthenticatorTest {
    private object Plain : Sealer {
        override fun seal(plain: ByteArray) = plain
        override fun open(sealed: ByteArray) = sealed
    }

    @Test
    fun `parallel 401s share one refresh and every call succeeds with the new token`() {
        val refreshes = AtomicInteger()
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/v2/auth/refresh" -> {
                    refreshes.incrementAndGet()
                    Thread.sleep(150)  // a slow refresh: the other callers pile up behind the lock
                    MockResponse(200, body = """{"accessToken":"new","refreshToken":"r2","expiresIn":900,
                        "accountId":"5b1e7c0e-0000-4000-8000-000000000002","deviceId":"5b1e7c0e-0000-4000-8000-000000000003","role":"member"}""")
                }
                else -> if (request.headers["Authorization"] == "Bearer new") MockResponse(200, body = "{}") else MockResponse(401)
            }
        }
        server.start()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val sessions = SessionStore(Files.createTempDirectory("s").resolve("session.bin").toFile(), Plain, scope)
        sessions.updateBlocking { Session(server = server.url("/").toString(), accessToken = "old", refreshToken = "r1") }
        val base = OkHttpClient()
        val client = base.newBuilder()
            .addInterceptor(AuthInterceptor(sessions))
            .authenticator(TokenAuthenticator(sessions, base, MutableSharedFlow(extraBufferCapacity = 1)))
            .build()

        val pool = Executors.newFixedThreadPool(8)
        val codes = pool.invokeAll((1..8).map {
            Callable { client.newCall(Request.Builder().url(server.url("/api/v2/home")).build()).execute().use { it.code } }
        }).map { it.get() }

        assertEquals(List(8) { 200 }, codes)
        assertEquals(1, refreshes.get())
        assertEquals("r2", sessions.current.refreshToken)  // the rotated token is what the next refresh presents
        pool.shutdown()
        scope.cancel()
        server.close()
    }
}
