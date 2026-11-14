package ru.musixai.app.core.data

import android.content.Context
import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.Serializer
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import ru.musixai.app.core.common.AppScope

@Serializable
internal data class InteractionPreferences(val haptics: Boolean = true, val catalog: Boolean = false)

internal object InteractionSerializer : Serializer<InteractionPreferences> {
    private val json = Json { ignoreUnknownKeys = true }
    override val defaultValue = InteractionPreferences()
    override suspend fun readFrom(input: InputStream): InteractionPreferences = try {
        json.decodeFromString(InteractionPreferences.serializer(), input.readBytes().decodeToString())
    } catch (error: SerializationException) {
        throw CorruptionException("Interaction preferences are unreadable", error)
    }
    override suspend fun writeTo(t: InteractionPreferences, output: OutputStream) {
        output.write(json.encodeToString(InteractionPreferences.serializer(), t).encodeToByteArray())
    }
}

/** Device-only preference. Remains silent until the persisted choice has been loaded. */
@Singleton
class HapticPreferences @Inject constructor(@ApplicationContext context: Context, @AppScope scope: CoroutineScope) {
    private val store = DataStoreFactory.create(
        serializer = InteractionSerializer,
        corruptionHandler = ReplaceFileCorruptionHandler { InteractionPreferences(haptics = false) },
        scope = scope,
        produceFile = { File(context.filesDir, "datastore/interactions.json") },
    )
    val enabled = store.data.catch { error ->
        if (error is IOException) emit(InteractionPreferences(haptics = false)) else throw error
    }.map { it.haptics }.stateIn(scope, SharingStarted.Eagerly, false)

    suspend fun setEnabled(enabled: Boolean) { store.updateData { it.copy(haptics = enabled) } }

    /** «Витрина» in Settings: seven taps on the version open it, and it stays open on this device. */
    val catalog = store.data.catch { error ->
        if (error is IOException) emit(InteractionPreferences()) else throw error
    }.map { it.catalog }.stateIn(scope, SharingStarted.Eagerly, false)

    suspend fun unlockCatalog() { store.updateData { it.copy(catalog = true) } }
}
