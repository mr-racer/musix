package ru.musixai.app.feature.player

// Generated from web/src/player/glyphs.tsx (instrument glyphs of the web player). Do not edit by hand.

internal class GlyphPart(val d: String, val fill: Boolean)

internal object InstrumentGlyphs {
    private val GUITAR = listOf(GlyphPart("M10.6 10.4c-1.3-1.3-3.4-1.2-4.4.4-.4.7-1.2 1-1.8 1.5-1.4 1.3-1.1 3.7.7 5.4 1.7 1.8 4.1 2.1 5.4.7.5-.6.8-1.4 1.5-1.8 1.6-1 1.7-3.1.4-4.4z", false), GlyphPart("M7 14.8a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0", false), GlyphPart("M10.4 12.6 18 5", false), GlyphPart("M17.2 3.6l3.2 3.2", false))
    private val CLEF = listOf(GlyphPart("M5.5 9.5a4.5 4.5 0 0 1 9 0c0 4.8-4.2 8.2-9 10", false), GlyphPart("M5.1 9.6a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0", true), GlyphPart("M17 7.6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0", true), GlyphPart("M17 11.6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0", true))
    private val SUB = listOf(GlyphPart("M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0", false), GlyphPart("M7.5 12a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0", false), GlyphPart("M10.7 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0", true))
    private val WAVE = listOf(GlyphPart("M2.5 12c1.2-4.5 3.3-4.5 4.75 0s3.55 4.5 4.75 0 3.3-4.5 4.75 0 3.55 4.5 4.75 0", false))
    private val VIOLIN = listOf(GlyphPart("M10.7 3.6a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0", false), GlyphPart("M12 4.9V9", false), GlyphPart("M9.3 9c-1.6 0-2.3 1.5-1.5 2.8.5.8.4 1.5-.3 2.2-1.4 1.4-.6 4.8 4.5 4.8s5.9-3.4 4.5-4.8c-.7-.7-.8-1.4-.3-2.2.8-1.3.1-2.8-1.5-2.8-.9 0-1.6.5-2.7.5S10.2 9 9.3 9z", false), GlyphPart("M10.2 13.4v2.3M13.8 13.4v2.3", false))
    private val TRUMPET = listOf(GlyphPart("M2.8 10.2v3.6M2.8 12h12.7", false), GlyphPart("M15.5 10.6 21 8v8l-5.5-2.6", false), GlyphPart("M8.5 12V8.6M11 12V8.6M13.5 12V8.6", false), GlyphPart("M7.8 8.6h1.4M10.3 8.6h1.4M12.8 8.6h1.4", false), GlyphPart("M7 12v2.2c0 1.2.8 2 2 2h5c1.2 0 2-.8 2-2", false))
    private val SAX = listOf(GlyphPart("M8 3.5h3.2c.9 0 1.6.4 2 1.1l1.3 2.1", false), GlyphPart("M14.5 6.7v8.3a4.5 4.5 0 0 1-9 0v-1", false), GlyphPart("M4 14h3.4", false), GlyphPart("M13.6 9.5a.9.9 0 1 0 1.8 0a.9.9 0 1 0 -1.8 0M13.6 12.5a.9.9 0 1 0 1.8 0a.9.9 0 1 0 -1.8 0", true))
    private val PIANO = listOf(GlyphPart("M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6z", false), GlyphPart("M7.5 12.5V18M12 12.5V18M16.5 12.5V18", false), GlyphPart("M6.4 6h2.2v6.5H6.4zM10.9 6h2.2v6.5h-2.2zM15.4 6h2.2v6.5h-2.2z", true))
    private val ORGAN = listOf(GlyphPart("M4 20v-7.5a1.2 1.2 0 0 1 2.4 0V20M8.6 20V8.5a1.2 1.2 0 0 1 2.4 0V20M13.2 20V6a1.2 1.2 0 0 1 2.4 0v14M17.8 20V10a1.2 1.2 0 0 1 2.4 0v10", false), GlyphPart("M3 20.2h18", false))
    private val SYNTH = listOf(GlyphPart("M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5z", false), GlyphPart("M3 11h18M7.5 11v8M12 11v8M16.5 11v8", false), GlyphPart("M6 8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0M10 8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0", true), GlyphPart("M14.8 8h3.4", false))
    private val SNARE = listOf(GlyphPart("M4 10.5a8 2.8 0 1 0 16 0a8 2.8 0 1 0 -16 0", false), GlyphPart("M4 10.5V16c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-5.5", false), GlyphPart("M8 13.4v4.4M16 13.4v4.4", false), GlyphPart("M13.6 8.2 19 3M10.4 8.2 5 3", false))
    private val KICK = listOf(GlyphPart("M4.5 11a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0", false), GlyphPart("M10.6 11a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0", true), GlyphPart("M6.5 17.5 4.5 21M17.5 17.5l2 3.5", false))
    private val CYMBAL = listOf(GlyphPart("M3.5 8.5c2.2-1.6 5.1-2.4 8.5-2.4s6.3.8 8.5 2.4c-2.2.9-5.1 1.4-8.5 1.4s-6.3-.5-8.5-1.4z", false), GlyphPart("M12 4.6v1.5M12 9.9V20.5M8.5 20.5l3.5-3.2 3.5 3.2", false))
    private val PADS = listOf(GlyphPart("M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z", false), GlyphPart("M13.4 7h3.6v3.6h-3.6zM7 13.4h3.6V17H7zM13.4 13.4h3.6V17h-3.6z", false), GlyphPart("M7 7h3.6v3.6H7z", true))
    private val MIC = listOf(GlyphPart("M12 3.5a2.8 2.8 0 0 0-2.8 2.8v4.9a2.8 2.8 0 0 0 5.6 0V6.3A2.8 2.8 0 0 0 12 3.5z", false), GlyphPart("M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5v4M9 20.5h6", false))
    private val HANDMIC = listOf(GlyphPart("M4.5 8.5a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", false), GlyphPart("M5.7 5.7l5.6 5.6", false), GlyphPart("M11.4 12.3 17.6 18.5a1.3 1.3 0 0 0 1.9-1.8l-6.3-6.2", false))
    private val NOTE = listOf(GlyphPart("M9 17.5V6l10-2v11", false), GlyphPart("M4.5 17.5a2.5 2 0 1 0 5 0a2.5 2 0 1 0 -5 0M14.5 15a2.5 2 0 1 0 5 0a2.5 2 0 1 0 -5 0", true))
    private val HEADPHONES = listOf(GlyphPart("M4 15v-3a8 8 0 0 1 16 0v3", false), GlyphPart("M4 14.5h2.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM20 14.5h-2.5a1 1 0 0 0-1 1v3.5a1 1 0 0 0 1 1H19a1 1 0 0 0 1-1z", false))

    val by: Map<String, List<GlyphPart>> = mapOf(
        "guitar" to GUITAR,
        "electric_guitar" to GUITAR,
        "acoustic_guitar" to GUITAR,
        "slide_guitar" to GUITAR,
        "banjo" to GUITAR,
        "mandolin" to GUITAR,
        "ukulele" to GUITAR,
        "sitar" to GUITAR,
        "bass" to CLEF,
        "bass_guitar" to CLEF,
        "double_bass" to CLEF,
        "bass_808" to SUB,
        "synth_bass" to WAVE,
        "strings" to VIOLIN,
        "harp" to VIOLIN,
        "brass" to TRUMPET,
        "winds" to SAX,
        "sax" to SAX,
        "woodwind" to SAX,
        "harmonica" to SAX,
        "bagpipes" to SAX,
        "accordion" to PIANO,
        "piano" to PIANO,
        "electric_piano" to PIANO,
        "harpsichord" to PIANO,
        "keys" to PIANO,
        "organ" to ORGAN,
        "synthesizer" to SYNTH,
        "synths" to SYNTH,
        "synth_other" to SYNTH,
        "lead" to SYNTH,
        "theremin" to WAVE,
        "drums" to SNARE,
        "drums_live" to SNARE,
        "drum_machine" to PADS,
        "kick" to KICK,
        "snare" to SNARE,
        "toms" to SNARE,
        "hihat" to CYMBAL,
        "cymbals" to CYMBAL,
        "voice" to MIC,
        "vocal" to MIC,
        "male" to MIC,
        "female" to MIC,
        "singing" to MIC,
        "choir" to MIC,
        "processed_voice" to MIC,
        "vocal_sample" to HANDMIC,
        "rap" to HANDMIC,
        "rap_singing" to HANDMIC,
        "listener" to HEADPHONES,
    )

    fun of(key: String): List<GlyphPart> = by[key] ?: NOTE
}
