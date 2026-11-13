package ru.musixai.app.core.data

import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class InteractionPreferencesTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun disablingHapticsSurvivesReopeningTheStore() = runTest {
        val file = File(temp.root, "interactions.json")
        val firstJob = SupervisorJob()
        val first = DataStoreFactory.create(InteractionSerializer, scope = CoroutineScope(firstJob + Dispatchers.IO), produceFile = { file })
        try {
            assertTrue(first.data.first().haptics)
            first.updateData { it.copy(haptics = false) }
        } finally { firstJob.cancelAndJoin() }

        val secondJob = SupervisorJob()
        val second = DataStoreFactory.create(InteractionSerializer, scope = CoroutineScope(secondJob + Dispatchers.IO), produceFile = { file })
        try { assertFalse(second.data.first().haptics) } finally { secondJob.cancelAndJoin() }
    }

    @Test fun corruptPreferencesRecoverSilently() = runTest {
        val file = temp.newFile("broken.json").apply { writeText("{broken") }
        val job = SupervisorJob()
        val store = DataStoreFactory.create(
            InteractionSerializer,
            corruptionHandler = ReplaceFileCorruptionHandler { InteractionPreferences(haptics = false) },
            scope = CoroutineScope(job + Dispatchers.IO), produceFile = { file },
        )
        try { assertFalse(store.data.first().haptics) } finally { job.cancelAndJoin() }
    }
}
