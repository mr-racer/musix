package ru.musixai.app.core.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import ru.musixai.app.core.database.MusixDatabase
import ru.musixai.app.core.network.MusixApi
import ru.musixai.app.core.network.Sealer
import ru.musixai.app.core.network.Session
import ru.musixai.app.core.network.SessionStore
import java.nio.file.Files

/** An in-memory Room and a MusixApi pointed at a MockWebServer. */
class Harness(val server: MockWebServer) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val db: MusixDatabase = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), MusixDatabase::class.java)
        .allowMainThreadQueries().build()
    private val sessions = SessionStore(Files.createTempDirectory("s").resolve("session.bin").toFile(), object : Sealer {
        override fun seal(plain: ByteArray) = plain
        override fun open(sealed: ByteArray) = sealed
    }, scope).also { it.updateBlocking { Session(server = server.url("/").toString().trimEnd('/'), accessToken = "t", refreshToken = "r") } }
    val api = MusixApi(OkHttpClient(), sessions, Dispatchers.IO)

    fun close() { db.close(); server.close() }
}

fun resource(name: String): String = Harness::class.java.getResource("/$name")!!.readText()
