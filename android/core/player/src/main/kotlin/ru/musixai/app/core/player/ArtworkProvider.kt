package ru.musixai.app.core.player

import android.content.ContentProvider
import android.content.ContentValues
import android.net.Uri
import android.os.ParcelFileDescriptor
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import ru.musixai.app.core.data.LibraryRepository
import java.io.File

/**
 * Cover art for Android Auto's browse lists (phase 8 §2). Auto loads only content URIs.
 * `content://<app>.artwork/<imageId>` serves the 256 px variant. It is fetched once into
 * the cache dir; after that the file answers, offline as well. Ids are content hashes,
 * and only ids in this account's mirror are served.
 */
class ArtworkProvider : ContentProvider() {
    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface Deps {
        fun library(): LibraryRepository
        fun http(): OkHttpClient
    }

    private val deps by lazy { EntryPointAccessors.fromApplication(context!!.applicationContext, Deps::class.java) }

    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val id = uri.lastPathSegment?.takeIf { ID.matches(it) } ?: return null
        val dir = File(context!!.cacheDir, "auto-art").apply { mkdirs() }
        val file = File(dir, "$id.img")
        if (!file.exists()) {
            val url = runBlocking { deps.library().images(listOf(id))[id]?.url(PX) } ?: return null
            val body = runCatching { deps.http().newCall(Request.Builder().url(url).build()).execute().use { r -> if (r.isSuccessful) r.body.bytes() else null } }.getOrNull() ?: return null
            val tmp = File(dir, "$id.tmp")
            tmp.writeBytes(body)
            tmp.renameTo(file)
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri) = "image/*"
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?) = null
    override fun insert(uri: Uri, values: ContentValues?) = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0

    companion object {
        private const val PX = 256
        private val ID = Regex("^[0-9a-f]{16,128}$")
        fun uri(packageName: String, imageId: String?): Uri? = imageId?.let { Uri.parse("content://$packageName.artwork/$it") }
    }
}
