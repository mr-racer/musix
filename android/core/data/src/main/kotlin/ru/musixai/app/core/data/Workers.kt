package ru.musixai.app.core.data

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

private val ONLINE = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

/** Sends the outbox; retried with backoff while the network or the server is down. */
@HiltWorker
class OutboxWorker @AssistedInject constructor(
    @Assisted ctx: Context,
    @Assisted params: WorkerParameters,
    private val outbox: Outbox,
) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = when (outbox.flush()) {
        Outbox.Flush.Done -> Result.success()
        is Outbox.Flush.Retry -> Result.retry()
    }

    companion object {
        fun schedule(ctx: Context) = WorkManager.getInstance(ctx).enqueueUniqueWork(
            "outbox", ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<OutboxWorker>().setConstraints(ONLINE)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build(),
        )
    }
}

/** The periodic /sync (spec §2: 15 min, network-constrained), plus an outbox flush. */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted ctx: Context,
    @Assisted params: WorkerParameters,
    private val sync: SyncEngine,
    private val outbox: Outbox,
) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = runCatching {
        outbox.flush()
        sync.sync()
    }.fold({ Result.success() }, { Result.retry() })

    companion object {
        fun schedule(ctx: Context) = WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
            "sync", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(ONLINE).build(),
        )
    }
}
