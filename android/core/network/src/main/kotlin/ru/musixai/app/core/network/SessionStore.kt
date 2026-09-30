package ru.musixai.app.core.network

import android.content.Context
import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.Serializer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import java.io.File
import java.io.InputStream
import java.io.OutputStream

private val json = Json { ignoreUnknownKeys = true }

private class SessionSerializer(private val sealer: Sealer) : Serializer<Session> {
    override val defaultValue = Session()

    override suspend fun readFrom(input: InputStream): Session = try {
        val bytes = input.readBytes()
        if (bytes.isEmpty()) defaultValue else json.decodeFromString(Session.serializer(), sealer.open(bytes).decodeToString())
    } catch (e: Exception) {
        // a key lost with a restore-from-backup (Keystore keys are device-bound): signed out
        throw CorruptionException("session unreadable", e)
    }

    override suspend fun writeTo(t: Session, output: OutputStream) =
        output.write(sealer.seal(json.encodeToString(Session.serializer(), t).encodeToByteArray()))
}

/** The session, encrypted on disk and mirrored in memory: OkHttp's interceptor and
 *  authenticator read [current] without suspending. */
class SessionStore(file: File, sealer: Sealer, scope: CoroutineScope) {
    private val store: DataStore<Session> = DataStoreFactory.create(
        serializer = SessionSerializer(sealer),
        corruptionHandler = androidx.datastore.core.handlers.ReplaceFileCorruptionHandler { Session() },
        scope = scope,
        produceFile = { file },
    )
    // The mirror is set by the write itself, not by collecting `store.data`: a collector lags
    // the write, and an authenticator that reads a stale token refreshes twice — with a
    // rotated refresh token, which the server treats as theft and revokes the whole family.
    private val state = MutableStateFlow(runBlocking { store.data.first() })
    val session: StateFlow<Session> = state

    val current: Session get() = state.value

    suspend fun update(f: (Session) -> Session): Session = store.updateData(f).also { state.value = it }

    /** Synchronous write for OkHttp threads (the authenticator runs on one). */
    fun updateBlocking(f: (Session) -> Session): Session = runBlocking { update(f) }

    companion object {
        fun create(context: Context, sealer: Sealer, scope: CoroutineScope) =
            SessionStore(File(context.filesDir, "datastore/session.bin"), sealer, scope)
    }
}

