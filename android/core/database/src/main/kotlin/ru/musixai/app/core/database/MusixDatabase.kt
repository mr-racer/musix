package ru.musixai.app.core.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Database(
    entities = [TrackEntity::class, TrackArtistEntity::class, ArtistEntity::class, AlbumEntity::class, ImageEntity::class,
        PlaylistEntity::class, PlaylistItemEntity::class, SignalEntity::class, KvEntity::class, OutboxEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class MusixDatabase : RoomDatabase() {
    abstract fun mirror(): MirrorDao
    abstract fun library(): LibraryDao
    abstract fun playlists(): PlaylistDao
    abstract fun outbox(): OutboxDao
}

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    /** One file per device install; an account switch wipes it (AccountGuard), never mixes. */
    @Provides @Singleton
    fun db(@ApplicationContext ctx: Context): MusixDatabase =
        Room.databaseBuilder(ctx, MusixDatabase::class.java, "musix.db").build()

    @Provides fun mirror(db: MusixDatabase) = db.mirror()
    @Provides fun library(db: MusixDatabase) = db.library()
    @Provides fun playlists(db: MusixDatabase) = db.playlists()
    @Provides fun outbox(db: MusixDatabase) = db.outbox()
}
