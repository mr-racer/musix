package ru.musixai.app.core.player

/** Custom session commands between our UI (a MediaController) and [PlaybackService]. */
object PlayerProtocol {
    const val CMD_FIRE = "musix.fire"
    const val CMD_WATER = "musix.water"
    const val CMD_PLAY_TRACKS = "musix.playTracks"
    const val CMD_START_STREAM = "musix.startStream"
    const val CMD_PLAY_NEXT = "musix.playNext"
    const val CMD_PLAY_SNIPPET = "musix.playSnippet"
    const val CMD_TAKE = "musix.take"  // handoff: continue the account's playback session here

    const val ARG_TRACK_IDS = "trackIds"
    const val ARG_INDEX = "index"
    const val ARG_POSITION_MS = "positionMs"
    const val ARG_CONTEXT = "context"
    const val ARG_TRACK_ID = "trackId"
    const val ARG_DURATION_MS = "durationMs"
    const val ARG_URL = "url"
    const val ARG_PLAY = "play"

    const val EVT_TASTE = "musix.taste"
    const val EVT_ERROR = "musix.error"

    const val EXTRA_MODE = "mode"
    const val EXTRA_SOURCE = "source"
    const val EXTRA_CONTEXT = "context"
    /** «Почему этот трек» from `/stream/next` (the chip text, then the detail lines). */
    const val EXTRA_REASON = "reason"
    const val EXTRA_REASON_DETAILS = "reasonDetails"
    const val EXTRA_NO_LISTEN = "noListen"
}
