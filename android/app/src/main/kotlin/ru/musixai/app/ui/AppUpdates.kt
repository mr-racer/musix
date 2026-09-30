package ru.musixai.app.ui

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import ru.musixai.app.BuildConfig
import ru.musixai.app.core.data.AccountRepository
import ru.musixai.app.core.data.AuthRepository
import ru.musixai.app.core.data.Release
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * In-app update for a sideloaded app (spec §7): `GET /app/android/latest` → a prompt →
 * download → the sha256 must match → PackageInstaller (the same key and package id, so it
 * installs over the running build). Checked on start and at most daily.
 */
@Singleton
class AppUpdates @Inject constructor(
    @ApplicationContext private val ctx: Context,
    private val account: AccountRepository,
    private val http: OkHttpClient,
    private val auth: AuthRepository,
) {
    private val _offer = MutableStateFlow<Release?>(null)
    val offer: StateFlow<Release?> = _offer
    val progress = MutableStateFlow<String?>(null)
    private val prefs = ctx.getSharedPreferences("musix_updates", Context.MODE_PRIVATE)

    suspend fun check(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - prefs.getLong("checked", 0) < 24 * 3_600_000L) return
        prefs.edit().putLong("checked", now).apply()
        val r = account.latest() ?: return
        if (r.versionCode > BuildConfig.VERSION_CODE && r.versionCode != prefs.getInt("dismissed", 0)) _offer.value = r
    }

    fun dismiss() { _offer.value?.let { prefs.edit().putInt("dismissed", it.versionCode).apply() }; _offer.value = null }

    suspend fun install(r: Release) {
        if (!ctx.packageManager.canRequestPackageInstalls()) {  // the user allows "install unknown apps" for MusiX once
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        progress.value = "Скачиваю…"
        val apk = withContext(Dispatchers.IO) {
            val url = if (r.url.startsWith("http")) r.url else auth.serverUrl() + r.url
            val f = File(ctx.cacheDir, "update.apk")
            http.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                check(resp.isSuccessful) { "HTTP ${resp.code}" }
                f.outputStream().use { resp.body.byteStream().copyTo(it) }
            }
            val sha = MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }
            check(sha.equals(r.sha256, ignoreCase = true)) { "sha256 mismatch" }  // never install bytes the server did not announce
            f
        }
        progress.value = "Устанавливаю…"
        withContext(Dispatchers.IO) {
            val installer = ctx.packageManager.packageInstaller
            val id = installer.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
            installer.openSession(id).use { s ->
                s.openWrite("musix.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
                val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallResult::class.java), PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                s.commit(pi.intentSender)
            }
        }
    }
}

/** PackageInstaller's answer: the confirmation screen, or the outcome. */
class InstallResult : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION") val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
