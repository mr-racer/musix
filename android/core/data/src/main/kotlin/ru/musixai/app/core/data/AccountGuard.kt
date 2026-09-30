package ru.musixai.app.core.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ru.musixai.app.core.database.KvEntity
import ru.musixai.app.core.database.MusixDatabase
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** Users never see each other's tracks (program invariant): the local mirror, the outbox
 *  and the media cache belong to one account. Signing out — or in as someone else — wipes
 *  them before anything is shown. */
@Singleton
class AccountGuard @Inject constructor(private val db: MusixDatabase, @ApplicationContext private val ctx: Context) {
    suspend fun claim(accountId: String) = withContext(Dispatchers.IO) {
        val owner = db.mirror().kv(OWNER)
        if (owner != null && owner != accountId) wipe()
        db.mirror().putKv(KvEntity(OWNER, accountId))
    }

    suspend fun wipe() = withContext(Dispatchers.IO) {
        db.clearAllTables()
        for (dir in listOf("media", "http", "image_cache")) File(ctx.cacheDir, dir).deleteRecursively()
    }

    private companion object { const val OWNER = "account" }
}
