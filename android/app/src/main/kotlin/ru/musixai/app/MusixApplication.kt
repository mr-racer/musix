package ru.musixai.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import ru.musixai.app.core.common.AppScope
import ru.musixai.app.core.data.AccountGuard
import ru.musixai.app.core.data.AuthRepository
import ru.musixai.app.core.data.Outbox
import ru.musixai.app.core.data.OutboxWorker
import ru.musixai.app.core.data.Realtime
import ru.musixai.app.core.data.SyncEngine
import ru.musixai.app.core.data.SyncWorker
import javax.inject.Inject

@HiltAndroidApp
class MusixApplication : Application(), Configuration.Provider {
    @Inject lateinit var workers: HiltWorkerFactory
    @Inject lateinit var auth: AuthRepository
    @Inject lateinit var guard: AccountGuard
    @Inject lateinit var outbox: Outbox
    @Inject lateinit var sync: SyncEngine
    @Inject lateinit var realtime: Realtime
    @Inject @AppScope lateinit var scope: CoroutineScope
    @Inject lateinit var player: ru.musixai.app.core.player.PlayerController
    @Inject lateinit var handoff: ru.musixai.app.core.player.Handoff

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workers).build()

    override fun onCreate() {
        super.onCreate()
        AuthRepository.APP_VERSION = BuildConfig.VERSION_NAME
        ru.musixai.app.feature.settings.APP_VERSION_CODE = BuildConfig.VERSION_CODE
        outbox.onEnqueue = { OutboxWorker.schedule(this) }
        handoff.start()
        // the widgets follow playback: re-rendered on each change the service pushes, never polled
        val widgets = kotlinx.coroutines.flow.MutableSharedFlow<Unit>(extraBufferCapacity = 1)
        ru.musixai.app.core.player.NowPlaying.onChange = { widgets.tryEmit(Unit) }
        scope.launch {
            @OptIn(kotlinx.coroutines.FlowPreview::class)
            widgets.debounce(250).collect {
                runCatching {
                    ru.musixai.app.widget.NowPlayingWidget().updateAll(this@MusixApplication)
                    ru.musixai.app.widget.StreamWidget().updateAll(this@MusixApplication)
                }
            }
        }
        scope.launch { auth.refused.collect { guard.wipe() } }  // a revoked session leaves nothing behind
        // signed out (or revoked): the last account's queue must not keep playing or show
        scope.launch { auth.signedIn.filter { !it }.collect { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { player.stop() } } }
        scope.launch {
            auth.signedIn.filter { it }.collect {
                SyncWorker.schedule(this@MusixApplication)
                OutboxWorker.schedule(this@MusixApplication)
                runCatching { sync.sync() }  // app start (spec §2)
            }
        }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = realtime.start()
            override fun onStop(owner: LifecycleOwner) = realtime.stop()
        })
    }
}
