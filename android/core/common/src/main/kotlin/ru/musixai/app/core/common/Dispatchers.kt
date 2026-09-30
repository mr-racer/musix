package ru.musixai.app.core.common

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Qualifier
import javax.inject.Singleton

@Qualifier @Retention(AnnotationRetention.BINARY) annotation class IoDispatcher
@Qualifier @Retention(AnnotationRetention.BINARY) annotation class AppScope

@Module
@InstallIn(SingletonComponent::class)
object CommonModule {
    @Provides @IoDispatcher fun io(): CoroutineDispatcher = Dispatchers.IO

    /** Work that must outlive a screen (sync, outbox flush, token writes). */
    @Provides @Singleton @AppScope
    fun appScope(@IoDispatcher io: CoroutineDispatcher): CoroutineScope = CoroutineScope(SupervisorJob() + io)
}
