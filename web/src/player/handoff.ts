import { create } from "zustand";
import { api, ok } from "../api/client";
import { db } from "../api/db";
import { warmFromMirror } from "../lib/images";
import { send, subscribe } from "../api/realtime";
import { player, usePlayer, type QueueItem } from "./engine";

/**
 * «Слушать на…» (phase 8 §1), the web's side.
 * - This tab says it can play, on every `ready`.
 * - While it owns the playback (it started playing here, or took it over), it publishes the
 *   state: on a track change, on play/pause and on a seek, and every 10 s while playing.
 * - `take`: the session is fetched and continued here from its position.
 * - `release`: pause; another device has it now.
 * - `command`: a remote press, applied to this queue (this tab owns it).
 */
export const useHandoff = create<{ remote: { device: string; trackId: string | null; playing: boolean } | null }>(() => ({ remote: null }));

let owner = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function publish(): void {
  const s = usePlayer.getState();
  if (!owner || s.index < 0 || !s.queue.length) return;
  const from = Math.max(0, s.index - 50);
  const win = s.queue.slice(from, from + 500);
  const at = win[s.index - from];
  send({
    type: "playback.state",
    state: {
      trackIds: win.map((q) => q.trackId), index: s.index - from, positionMs: Math.round(s.positionMs), playing: s.playing,
      mode: s.mode, contextType: at?.contextType ?? null, contextId: at?.contextId ?? null,
    },
  });
}

const soon = () => { clearTimeout(timer); timer = setTimeout(publish, 400); };

usePlayer.subscribe((s, prev) => {
  if (s.playing && !prev.playing) {
    owner = true;
    useHandoff.setState({ remote: null });  // the music is here now
  }
  if (!owner) return;
  const seeked = Math.abs(s.positionMs - prev.positionMs) > 4000;  // positions tick far finer than this
  if (s.index !== prev.index || s.playing !== prev.playing || s.queue !== prev.queue || seeked) soon();
});
setInterval(() => { if (owner && usePlayer.getState().playing) publish(); }, 10_000);

async function take(play: boolean): Promise<void> {
  const session = await ok(api.GET("/api/v2/playback/session"));
  const st = session.state;
  const rows = await db.tracks.bulkGet(st.trackIds);
  const items: QueueItem[] = [];
  let index = 0;
  rows.forEach((t, i) => {
    if (!t) return;  // not in this mirror (yet): left out, the rest plays
    if (i === st.index) index = items.length;
    items.push({ trackId: t.id, title: t.title, artist: t.artist, artistId: t.artistIds[0] ?? null, album: t.album, albumId: t.albumId,
      coverImageId: t.coverImageId, durationMs: t.durationMs, source: "manual", contextType: (st.contextType ?? "queue") as QueueItem["contextType"], contextId: st.contextId ?? null });
  });
  if (!items.length) return;
  await warmFromMirror(items.map((i) => i.coverImageId));  // covers of a queue built elsewhere
  owner = true;
  useHandoff.setState({ remote: null });
  // the state is up to 10 s old: a playing track has moved on since
  const lag = st.playing ? Math.max(0, Date.now() - Date.parse(session.updatedAt)) : 0;
  const here = rows[st.index];
  const at = here ? Math.min(st.positionMs + lag, Math.max(0, (here.durationMs ?? 0) - 1000)) : 0;
  await player.adopt(items, index, at, st.mode ?? "list", play);
  publish();
}

subscribe((e) => {
  if (e.type === "ready") {
    send({ type: "device.hello", canPlay: true });
    publish();
  } else if (e.type === "playback.take") {
    void take(e.play);
  } else if (e.type === "playback.release") {
    owner = false;
    player.pause();
  } else if (e.type === "playback.state") {
    useHandoff.setState({ remote: { device: e.device, trackId: e.trackId, playing: e.playing } });
    if (e.playing && owner && usePlayer.getState().playing) { owner = false; player.pause(); }  // the account plays elsewhere now
  } else if (e.type === "playback.command" && owner) {
    if (e.command === "play") void player.play();
    else if (e.command === "pause") player.pause();
    else if (e.command === "toggle") player.toggle();
    else if (e.command === "next") void player.next();
    else if (e.command === "prev") void player.prev();
    else if (e.command === "seek" && e.positionMs != null) player.seek(e.positionMs);
    else if (e.command === "signal" && e.kind) void player.react(e.kind);
  }
});

/** The picker's list: the devices online now (this one included, marked). */
export const devicesQuery = { queryKey: ["devices", "active"], queryFn: () => ok(api.GET("/api/v2/devices/active")), refetchInterval: 15_000 };

export async function transfer(toDevice: string): Promise<void> {
  await ok(api.POST("/api/v2/playback/transfer", { body: { toDevice, play: true } }));
}
