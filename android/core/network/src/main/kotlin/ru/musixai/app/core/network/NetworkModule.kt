package ru.musixai.app.core.network

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import okhttp3.Cache
import okhttp3.OkHttpClient
import ru.musixai.app.core.common.AppScope
import ru.musixai.app.core.common.IoDispatcher
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton
    fun sessions(@ApplicationContext ctx: Context, @AppScope scope: CoroutineScope): SessionStore =
        SessionStore.create(ctx, KeystoreSealer(), scope)

    @Provides @Singleton fun signOut() = SignOutSignal()

    /** The one client: API, images (Coil) and audio (Media3) share its pool and cache. */
    @Provides @Singleton
    fun okhttp(@ApplicationContext ctx: Context, sessions: SessionStore, signOut: SignOutSignal): OkHttpClient {
        val base = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        return base.newBuilder()
            .cache(Cache(File(ctx.cacheDir, "http"), 64L * 1024 * 1024))
            .addInterceptor(AuthInterceptor(sessions))
            .authenticator(TokenAuthenticator(sessions, base, signOut.flow))
            .build()
    }

    @Provides @Singleton
    fun api(client: OkHttpClient, sessions: SessionStore, @IoDispatcher io: CoroutineDispatcher) = MusixApi(client, sessions, io)
}
