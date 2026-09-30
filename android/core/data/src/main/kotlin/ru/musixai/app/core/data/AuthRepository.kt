package ru.musixai.app.core.data

import android.os.Build
import app.musix.api.models.DeviceIn
import app.musix.api.models.LoginIn
import app.musix.api.models.RegisterIn
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.SessionStore
import ru.musixai.app.core.network.SignOutSignal
import ru.musixai.app.core.network.withTokens
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: MusixApi,
    private val sessions: SessionStore,
    private val guard: AccountGuard,
    private val outbox: Outbox,
    signOut: SignOutSignal,
) {
    val signedIn: Flow<Boolean> = sessions.session.map { it.signedIn }.distinctUntilChanged()
    val server: Flow<String> = sessions.session.map { it.server }.distinctUntilChanged()
    val accountId: String? get() = sessions.current.accountId
    fun serverUrl(): String = sessions.current.server.trimEnd('/')
    val refused: SharedFlow<Unit> = signOut.events

    private fun device() = DeviceIn(name = "${Build.MANUFACTURER} ${Build.MODEL}".trim(), platform = DeviceIn.Platform.android,
        appVersion = APP_VERSION)

    suspend fun setServer(url: String) {
        val clean = normalizeServer(url)
        sessions.update { it.copy(server = clean) }
    }

    suspend fun login(email: String, password: String) {
        val t = api.call { identity.loginApiV2AuthLoginPost(LoginIn(email = email.trim(), password = password, device = device())) }
        guard.claim(t.accountId.toString())  // before the session flips: no frame shows the last account's data
        sessions.update { it.withTokens(t) }
    }

    suspend fun register(email: String, password: String, invite: String) {
        val t = api.call { identity.registerApiV2AuthRegisterPost(RegisterIn(email = email.trim(), password = password, device = device(), inviteCode = invite.trim())) }
        guard.claim(t.accountId.toString())
        sessions.update { it.withTokens(t) }
    }

    /** Local sign-out always succeeds; the server calls are best effort. Unsent listens and
     *  edits get one flush first — the wipe that follows would otherwise drop them. */
    suspend fun logout() {
        runCatching { outbox.flush() }
        runCatching { api.call { identity.logoutApiV2AuthLogoutPost() } }
        sessions.update { it.copy(accessToken = null, refreshToken = null, accountId = null, deviceId = null, role = null) }
        guard.wipe()
    }

    companion object {
        var APP_VERSION: String? = null

        /** "musixai.ru" → "https://musixai.ru"; release builds allow HTTPS only (spec §2). */
        fun normalizeServer(url: String): String {
            val u = url.trim().trimEnd('/')
            return if (u.startsWith("http://") || u.startsWith("https://")) u else "https://$u"
        }
    }
}
