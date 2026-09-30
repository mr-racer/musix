package ru.musixai.app.core.network

import kotlinx.serialization.Serializable

/** Who is signed in where. `server` survives a sign-out (the next login goes to the same box). */
@Serializable
data class Session(
    val server: String = DEFAULT_SERVER,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val accountId: String? = null,
    val deviceId: String? = null,
    val role: String? = null,
    /** epoch ms when the access token stops working (refresh ~1 min before) */
    val accessExpiresAt: Long = 0,
) {
    val signedIn: Boolean get() = refreshToken != null

    companion object {
        const val DEFAULT_SERVER = "https://musixai.ru"
    }
}
