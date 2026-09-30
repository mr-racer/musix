import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ok, type Schemas } from "../../api/client";
import { remember } from "../../lib/images";
import { Cover } from "../../ui/Cover";
import { Icon } from "../../ui/icons";
import { TrackList } from "../../ui/TrackList";
import css from "./search.module.css";

type Mode = "auto" | "lyrics" | "sound";
type Search = { q?: string; sections?: string; years?: string; tags?: string };
const SECTIONS: Record<Mode, string> = { auto: "catalog,lyrics,sound", lyrics: "lyrics", sound: "sound" };
const SUGGESTIONS = ["грустный синти-поп под ночь", "песня про дорогу домой", "энергичный рок для тренировки", "как дождь за окном"];

export const Route = createFileRoute("/_app/search")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    sections: typeof s.sections === "string" ? s.sections : undefined,
    years: typeof s.years === "string" && s.years ? s.years : undefined,
    tags: typeof s.tags === "string" && s.tags ? s.tags : undefined,
  }),
  component: SearchView,
});

/** The assistant tab's «Поиск» half (golden search-desktop): the centered composer with
 *  its modes, the year and sound chips, then the result sections. Typing searches the
 *  catalog only (fast); Enter runs the full search (lyrics and sound too). */
function SearchView() {
  const s = Route.useSearch();
  const nav = useNavigate({ from: "/search" });
  const mode: Mode = s.sections === "lyrics" ? "lyrics" : s.sections === "sound" ? "sound" : "auto";
  const [text, setText] = useState(s.q ?? "");
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => setText(s.q ?? ""), [s.q]);
  useEffect(() => {
    if (!text.trim() || text === s.q) return setTyped(null);
    const t = setTimeout(() => setTyped(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text, s.q]);

  const facets = useQuery({ queryKey: ["facets"], queryFn: () => ok(api.GET("/api/v2/library/facets")), staleTime: 10 * 60_000 }).data;
  const q = typed ?? s.q;
  const sections = typed ? "catalog" : SECTIONS[mode];
  const res = useQuery({
    queryKey: ["search", q, sections, s.years, s.tags],
    enabled: !!q,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await ok(api.GET("/api/v2/search", { params: { query: { q: q!, limit: 20, sections, ...(s.years ? { years: s.years } : {}), ...(s.tags ? { tags: s.tags } : {}) } } }));
      remember(r.images);
      return r;
    },
  });
  const go = (patch: Partial<Search>) => void nav({ search: (prev) => ({ ...prev, ...patch }) });
  const toggleIn = (list: string | undefined, v: string) => {
    const set = new Set(list ? list.split(",") : []);
    set.has(v) ? set.delete(v) : set.add(v);
    return set.size ? [...set].join(",") : undefined;
  };

  return (
    <div className={css.page}>
      <div className={css.glow} aria-hidden />
      <section className={q ? css.heroCompact : css.hero}>
        {!q && (
          <>
            <h1 className={css.title}>Что послушаем?</h1>
            <p className={css.sub}>Опиши настроение, текст, звук или жанр — я найду это в твоей библиотеке.</p>
          </>
        )}
        <form className={css.composer} onSubmit={(e) => { e.preventDefault(); setTyped(null); go({ q: text.trim() || undefined }); }}>
          <input className={css.input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Опиши музыку…" aria-label="Поиск" autoFocus={!q} />
          <button type="submit" className={css.send} aria-label="Искать"><Icon name="Next" size={16} /></button>
          <div className={css.modes} role="radiogroup" aria-label="Что искать">
            {(["auto", "lyrics", "sound"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? css.modeOn : css.mode}
                onClick={() => go({ sections: m === "auto" ? undefined : m })}>
                {{ auto: "✦ Auto", lyrics: "Текст", sound: "Звук" }[m]}
              </button>
            ))}
          </div>
        </form>
        {facets && (
          <div className={css.facets}>
            <div className={css.facetRow}>
              <span className={css.facetLabel}>Годы</span>
              {facets.decades.map((d) => {
                const on = s.years?.split(",").includes(d.value);
                return <button key={d.value} type="button" aria-pressed={on} className={on ? css.chipOn : css.chip} onClick={() => go({ years: toggleIn(s.years, d.value) })}>{d.value}<span>{d.count}</span></button>;
              })}
            </div>
            <div className={css.facetRow}>
              <span className={css.facetLabel}>Звук</span>
              {facets.tags.slice(0, 10).map((t) => {
                const on = s.tags?.split(",").includes(t.value);
                return <button key={t.value} type="button" aria-pressed={on} className={on ? css.chipOn : css.chip} onClick={() => go({ tags: toggleIn(s.tags, t.value) })}>{t.value}<span>{t.count}</span></button>;
              })}
            </div>
          </div>
        )}
        {!q && (
          <div className={css.suggestions}>
            {SUGGESTIONS.map((x) => <button key={x} type="button" className={css.suggestion} onClick={() => { setText(x); go({ q: x }); }}>{x}</button>)}
          </div>
        )}
      </section>
      {q && <Results r={res.data} loading={res.isFetching} error={res.isError} />}
    </div>
  );
}

function Results({ r, loading, error }: { r: Schemas["SearchOut"] | undefined; loading: boolean; error: boolean }) {
  if (error) return <p className={css.note}>Поиск не ответил — попробуй ещё раз.</p>;
  if (!r) return <p className={css.note}>Ищу…</p>;
  const empty = !r.tracks.length && !r.albums.length && !r.artists.length && !r.lyrics.length && !r.sound.length;
  return (
    <div className={css.results} aria-busy={loading}>
      {(r.degraded ?? []).length > 0 && <p className={css.note}>Часть поиска сейчас недоступна — показываю, что нашлось.</p>}
      {empty && <p className={css.note}>Ничего не нашлось. Попробуй описать иначе.</p>}
      {r.artists.length > 0 && (
        <Section title="Артисты">
          <div className={css.artists}>
            {r.artists.map((a) => (
              <Link key={a.id} to="/artist/$id" params={{ id: a.id }} className={css.artist}>
                <Cover id={a.imageId} size={88} radius={44} />
                <span>{a.name}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}
      {r.tracks.length > 0 && <Section title="Треки"><TrackList tracks={r.tracks} /></Section>}
      {r.lyrics.length > 0 && <Section title="По тексту"><TrackList tracks={r.lyrics.map((x) => x.track)} /></Section>}
      {r.sound.length > 0 && <Section title="По звучанию"><TrackList tracks={r.sound.map((x) => x.track)} /></Section>}
      {r.albums.length > 0 && (
        <Section title="Альбомы">
          <div className={css.albums}>
            {r.albums.map((a) => (
              <Link key={a.id} to="/album/$id" params={{ id: a.id }} className={css.album}>
                <Cover id={a.coverImageId} size={160} radius={12} />
                <span className={css.albumTitle}>{a.title}</span>
                <span className={css.albumSub}>{[a.albumArtist?.name, a.year].filter(Boolean).join(" · ")}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={css.section}>
      <h2 className={css.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}
