package ru.musixai.app.core.designsystem

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * The v2 text roles (2026-11-14 spec §6, №1): the token scale `MusixScale` (11 / 13 / 15 / 18 /
 * 24) in the web's three voices — Geist for the interface, Noto Sans for what is read (facts,
 * answers, bios), JetBrains Mono with tabular figures for time and counts. Styles carry no
 * colour: the caller says how loud the text is.
 *
 * A set of its own next to v1's `MusixType`, which stays untouched until its last screen moves
 * (changing it in place would move every v1 screen and the home at once).
 */
@Immutable
data class MusixText(
    /** Credits labels, the island: Geist 500 11, tracked; set it in capitals. */
    val cap: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.Medium, fontSize = MusixScale.Cap, lineHeight = 1.3.em, letterSpacing = 0.14.em),
    /** Secondary lines: Geist 13. */
    val caption: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontSize = MusixScale.Sm, lineHeight = 1.4.em),
    /** Buttons, pills, tabs: Geist 500 13. */
    val label: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.Medium, fontSize = MusixScale.Sm, lineHeight = 1.3.em, letterSpacing = 0.01.em),
    /** The interface's body: Geist 15. */
    val body: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontSize = MusixScale.Body, lineHeight = 1.45.em),
    /** What is read: Noto Sans 15 / 1.5. */
    val reading: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Sans, fontSize = MusixScale.Body, lineHeight = 1.5.em, letterSpacing = (-0.01).em),
    /** A row's title, a card's head: Geist 600 18. */
    val lead: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.SemiBold, fontSize = MusixScale.Lead, lineHeight = 1.3.em, letterSpacing = (-0.01).em),
    /** A section: Geist 700 24. */
    val heading: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.Bold, fontSize = MusixScale.H, lineHeight = 1.2.em, letterSpacing = (-0.02).em),
    /** A screen's title on the phone: Geist 700 32, tight (the player's title voice, `clamp(34px…)`). */
    val title: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Geist, fontWeight = FontWeight.Bold, fontSize = 32.sp, lineHeight = 1.08.em, letterSpacing = (-0.035).em),
    /** Time, counts, the Lossless badge: JetBrains Mono 13, tabular. */
    val number: TextStyle = TextStyle(fontFamily = MusixFontFamilies.Mono, fontSize = MusixScale.Sm, lineHeight = 1.3.em, fontFeatureSettings = "tnum"),
)

val LocalMusixText = staticCompositionLocalOf { MusixText() }

/** `MusixTheme.text.body` — the v2 roles. */
val MusixTheme.text: MusixText
    @Composable @ReadOnlyComposable get() = LocalMusixText.current
