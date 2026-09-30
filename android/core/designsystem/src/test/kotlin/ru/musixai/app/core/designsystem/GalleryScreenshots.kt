package ru.musixai.app.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.musixai.app.core.designsystem.component.BrandMark
import ru.musixai.app.core.designsystem.component.Cover
import ru.musixai.app.core.designsystem.component.CtaButton
import ru.musixai.app.core.designsystem.component.Empty
import ru.musixai.app.core.designsystem.component.Eyebrow
import ru.musixai.app.core.designsystem.component.LiquidGlass
import ru.musixai.app.core.designsystem.component.MosaicCover
import ru.musixai.app.core.designsystem.component.MusixField
import ru.musixai.app.core.designsystem.component.SegmentOption
import ru.musixai.app.core.designsystem.component.Segmented
import ru.musixai.app.core.designsystem.component.Skel
import ru.musixai.app.core.designsystem.component.Spinner
import ru.musixai.app.core.designsystem.component.TabPair
import ru.musixai.app.core.designsystem.component.ToggleSwitch

/** The component gallery in both themes, for review against design/golden (not an assertion). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class GalleryScreenshots {
    @Test fun dark() = captureRoboImage("build/outputs/roborazzi/gallery-dark.png") { Gallery(true) }
    @Test fun light() = captureRoboImage("build/outputs/roborazzi/gallery-light.png") { Gallery(false) }
}

@Composable
private fun Gallery(dark: Boolean) = MusixTheme(dark) {
    val c = MusixTheme.colors
    Column(Modifier.width(411.dp).background(c.bg).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { BrandMark(46.dp); Eyebrow("Твой вайб", Modifier.padding(top = 16.dp)) }
        Text("Электронный пульс и соул-темп", style = MusixTheme.type.title.copy(color = c.text))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Cover(null, "Группа крови", "Кино", size = 56.dp)
            Cover(null, "Мракобесие и джаз", "Агата Кристи", size = 56.dp)
            MosaicCover(emptyList(), size = 56.dp)
            MosaicCover(listOf(null, null, null), size = 56.dp)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ToggleSwitch(true, {}); ToggleSwitch(false, {}); Spinner(20.dp)
        }
        Segmented("albums", listOf(SegmentOption("albums", "Альбомы"), SegmentOption("recent", "Недавние"), SegmentOption("stats", "Статистика")), {})
        TabPair(listOf("Песня", "Артист"), 0, {})
        LiquidGlass(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                MusixField("", {}, "строчка из песни…")
                CtaButton("Войти", {}, Modifier.fillMaxWidth())
            }
        }
        Skel(Modifier.fillMaxWidth().size(height = 46.dp, width = 300.dp), 12.dp)
        Empty()
    }
}
