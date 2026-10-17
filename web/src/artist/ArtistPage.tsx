import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { db, rowToTrack } from "../api/db";
import { artistQuery } from "../api/queries";
import { imageUrl, remember } from "../lib/images";
import { playArtist } from "../library/actions";
import { fromTrack, player } from "../player/engine";
import { flyToMini } from "../player/MiniPlayer";
import glass from "../ui/glass.module.css";
import { Icon } from "../ui/icons";
import css from "./artist.module.css";
import { Facts, Songs, You } from "./Body";
import { cx, Hero } from "./Hero";
import { level, prep, type Bio } from "./model";
import { QuizCard, QuizWindow } from "./Quiz";
import { Timeline } from "./Timeline";
import { BioWindow } from "./Windows";

export const bioQuery = (id: string) => ({
  queryKey: ["bio", id],
  queryFn: async (): Promise<Bio> => (await api.GET("/api/v2/artists/{artist_id}/bio", { params: { path: { artist_id: id } } })).data ?? null,
  staleTime: 30 * 60_000,
});

/** The artist page «Кадр» (design/reference/artist, approved 2026-10-17). */
export function ArtistPage({ id }: { id: string }) {
  const page = useQuery(artistQuery(id)).data!;
  const bio = useQuery(bioQuery(id)).data ?? null;
  const m = useMemo(() => prep(page, bio), [page, bio]);
  const lv = useMemo(() => level(m.you.plays, m.albums), [m]);
  const [win, setWin] = useState<{ kind: "bio" | "quiz"; from: DOMRect } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [head, setHead] = useState(false);
  const hero = useRef<HTMLElement | null>(null);
  const avatar = imageUrl(page.photoId ?? page.artist.imageId, 96);

  // the glass head arrives once the frame has scrolled away (no scroll handler: an observer)
  useEffect(() => {
    const el = hero.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHead(!!e && !e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: "-90px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const all = async () => {
    const rows = await db.tracks.where("artistIds").equals(id).toArray();
    const rank = new Map(page.topTracks.map((t, i) => [t.id, i]));
    const rest = rows.filter((r) => !rank.has(r.id)).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (a.discNo ?? 0) - (b.discNo ?? 0) || (a.trackNo ?? 0) - (b.trackNo ?? 0));
    return [...page.topTracks, ...rest.map(rowToTrack)];
  };
  const onPlay = (from: HTMLElement | null) => { flyToMini(from); void all().then((ts) => player.playTracks(ts.map((t) => fromTrack(t, "artist", id)), 0)); };
  const onStream = async () => {
    if (streaming) return;
    setStreaming(true);
    try {
      const res = await api.POST("/api/v2/stream/artist", { body: { artistId: id, limit: 40 } });
      if (res.data?.tracks.length) { remember(res.data.images); await player.playTracks(res.data.tracks.map((t) => fromTrack(t, "artist", id)), 0); }
    } finally { setStreaming(false); }
  };
  const covers = m.albums.map((a) => a.cover);

  return (
    <div className={css.page} style={{ ["--tint" as string]: m.tint, ["--metal" as string]: lv.m, ["--metalbg" as string]: lv.bg, ["--metaltext" as string]: lv.tx }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <linearGradient id="mxGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3c9" /><stop offset=".35" stopColor="#ecc96f" /><stop offset=".7" stopColor="#b88b30" /><stop offset="1" stopColor="#7a5717" /></linearGradient>
          <linearGradient id="mxBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b3b42" /><stop offset="1" stopColor="#0f0f12" /></linearGradient>
        </defs>
      </svg>
      <div className={css.frame}>
        <Hero m={m} heroRef={(el) => { hero.current = el; }} streaming={streaming}
          onPlay={onPlay} onShuffle={(from) => void playArtist(id, from)} onStream={() => void onStream()}
          onBio={(from) => setWin({ kind: "bio", from: from.getBoundingClientRect() })} />
        <div className={cx("in", "body")}>
          {m.albums.length > 0 && (
            <section>
              <h2 className={css.h2}>Дискография <small>{m.albums.length} в библиотеке · по годам</small></h2>
              <Timeline m={m} />
            </section>
          )}
          <section>
            <h2 className={css.h2}>Ты и {m.name}</h2>
            <div className={css.row2}>
              <You m={m} lv={lv} />
              <div className={css.side2}>
                <QuizCard name={m.name} covers={covers} tracks={m.tracks} onOpen={(from) => setWin({ kind: "quiz", from: from.getBoundingClientRect() })} />
                {m.facts.length > 0 && <Facts facts={m.facts} />}
              </div>
            </div>
          </section>
          {page.topTracks.length > 0 && <Songs id={id} top={page.topTracks} plays={page.plays ?? {}} total={m.tracks} heard={m.you.plays} />}
        </div>
      </div>
      {createPortal(
        <div className={cx("tok", "minihead", glass.lg, head && "on")} data-mx-theme="dark" aria-hidden={!head}>
          {avatar && <img src={avatar} alt="" />}<b>{m.name}</b>
          <button type="button" className={css.pp} aria-label="Слушать" onClick={() => onPlay(null)}><Icon name="Play" size={13} /></button>
        </div>,
        document.body,
      )}
      {win?.kind === "bio" && <BioWindow from={win.from} onClose={() => setWin(null)} tint={m.tint} img={avatar} name={m.name} text={m.bio} origin={m.nameOrigin} />}
      {win?.kind === "quiz" && <QuizWindow from={win.from} onClose={() => setWin(null)} tint={m.tint} img={avatar} name={m.name} artistId={id} />}
    </div>
  );
}
