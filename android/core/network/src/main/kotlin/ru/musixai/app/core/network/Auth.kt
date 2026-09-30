package ru.musixai.app.core.network

import app.musix.api.infrastructure.Serializer
import app.musix.api.models.RefreshIn
import app.musix.api.models.Tokens
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.encodeToString
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route

private val NO_AUTH = listOf("/api/v2/auth/login", "/api/v2/auth/register", "/api/v2/auth/refresh", "/api/v2/auth/setup")

fun Session.withTokens(t: Tokens, now: Long = System.currentTimeMillis()) = copy(
    accessToken = t.accessToken, refreshToken = t.refreshToken, accountId = t.accountId.toString(), deviceId = t.deviceId.toString(),
    role = t.role, accessExpiresAt = now + t.expiresIn * 1000L,
)

/** Bearer on every API call except the auth endpoints. */
class AuthInterceptor(private val sessions: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val token = sessions.current.accessToken
        if (token == null || req.url.encodedPath in NO_AUTH || req.header("Authorization") != null) {
            return chain.proceed(req)
        }
        return chain.proceed(req.newBuilder().header("Authorization", "Bearer $token").build())
    }
}

/**
 * On a 401: ONE refresh at a time (the server rotates refresh tokens and treats a reused
 * one as theft — two parallel refreshes would revoke the whole family). A request whose
 * token is already stale just retries with the fresh one. A refused refresh signs out.
 */
class TokenAuthenticator(
    private val sessions: SessionStore,
    private val refreshClient: OkHttpClient,
    private val signedOut: MutableSharedFlow<Unit>,
) : Authenticator {
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        val req = response.request
        if (req.url.encodedPath in NO_AUTH || responseCount(response) >= 2) return null
        val sent = req.header("Authorization")?.removePrefix("Bearer ")
        synchronized(lock) {
            val now = sessions.current
            if (now.accessToken != null && now.accessToken != sent) {
                return req.newBuilder().header("Authorization", "Bearer ${now.accessToken}").build()
            }
            val refresh = now.refreshToken ?: return null
            val body = Serializer.kotlinxSerializationJson.encodeToString(RefreshIn(refreshToken = refresh))
                .toRequestBody("application/json".toMediaType())
            val call = Request.Builder().url(req.url.resolve("/api/v2/auth/refresh")!!).post(body).build()
            refreshClient.newCall(call).execute().use { r ->
                if (r.code == 401 || r.code == 403) {
                    sessions.updateBlocking { it.copy(accessToken = null, refreshToken = null, accountId = null, deviceId = null, role = null) }
                    signedOut.tryEmit(Unit)
                    return null
                }
                if (!r.isSuccessful) return null  // a network or server error: try again later, stay signed in
                val tokens = Serializer.kotlinxSerializationJson.decodeFromString(Tokens.serializer(), r.body.string())
                val fresh = sessions.updateBlocking { it.withTokens(tokens) }
                return req.newBuilder().header("Authorization", "Bearer ${fresh.accessToken}").build()
            }
        }
    }

    private fun responseCount(r: Response): Int {
        var n = 1
        var p = r.priorResponse
        while (p != null) { n++; p = p.priorResponse }
        return n
    }
}

/** Emitted when the server refuses the session (revoked family, deleted device). */
class SignOutSignal { val flow = MutableSharedFlow<Unit>(extraBufferCapacity = 1); val events: SharedFlow<Unit> get() = flow }
