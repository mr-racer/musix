import { useEffect, useMemo, useRef, useState } from "react";
import { addToPlaylist, createPlaylist } from "../api/playlists";
import { db } from "../api/db";
import { warmFromMirror } from "../lib/images";
import { useLive } from "../lib/live";
import css from "./AddToPlaylist.module.css";
import { controls } from "./controls";
import { Cover } from "./Cover";
import { Icon } from "./icons";

const LEAVE_MS = 190;
const SPRING = "cubic-bezier(.34,1.56,.64,1)"; // --mx-ease-spring, for the Web Animations below
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

type Props = {
  trackIds: string[];
  /** Asked to close: after an add, on Escape, on a click outside. Called once the menu has left. */
  onDone: () => void;
  /** `false` plays the leaving and then unmounts. A parent that mounts the menu only while it
   *  is open may leave this out: then only the menu's own closes are animated. */
  open?: boolean;
  /** The picture that flies into the chosen playlist (the player's cover). */
  from?: () => HTMLImageElement | null;
};

/** «+»: the track into a playlist, or into a new one (design/code/components.md).
 *  A physical thing (design/code/principles.md): the menu grows out of its button and goes
 *  back into it, its rows rise in one after another and give under a press, and with `from`
 *  the cover itself shrinks, flies into the playlist's thumbnail and is taken in.
 *  The wrapper around the trigger and the menu carries `data-pop-anchor`: a click anywhere
 *  outside it closes the menu, a click on the trigger is the parent's toggle. */
export function AddToPlaylist({ open = true, ...rest }: Props) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) { setMounted(true); setLeaving(false); return; }
    setLeaving(true);
    const t = setTimeout(() => setMounted(false), LEAVE_MS);
    return () => clearTimeout(t);
  }, [open]);
  return mounted ? <Menu {...rest} leaving={leaving} /> : null;
}

/** The cover shrinks and flies into `target`, which swells to take it. The clone is painted
 *  from the pixels on screen (a new <img> would have to load first). It flies an arc: across
 *  and down are eased differently, and it lifts a little before it goes. Resolves when the
 *  cover is in. */
function flyInto(pic: HTMLImageElement | null, target: Element | null): Promise<void> {
  if (!pic || !target || !pic.complete || !pic.naturalWidth || reduced()) return Promise.resolve();
  const stage = pic.closest<HTMLElement>("[data-player-cover]") ?? pic; // the untilted box
  const a = stage.getBoundingClientRect(), b = target.getBoundingClientRect();
  if (!a.width || !b.width) return Promise.resolve();
  const side = Math.round(a.width * Math.min(window.devicePixelRatio || 1, 2));
  const cut = Math.min(pic.naturalWidth, pic.naturalHeight);
  const g = document.createElement("canvas");
  g.width = g.height = side;
  g.getContext("2d")?.drawImage(pic, (pic.naturalWidth - cut) / 2, (pic.naturalHeight - cut) / 2, cut, cut, 0, 0, side, side);
  const r = parseFloat(getComputedStyle(stage).getPropertyValue("--r-cover")) || 10;
  const rt = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 8;
  const shell = document.createElement("div"); // moves across; the canvas inside moves down and shrinks
  Object.assign(shell.style, { position: "fixed", left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, zIndex: "70", pointerEvents: "none" });
  Object.assign(g.style, { display: "block", width: "100%", height: "100%", borderRadius: `${r}px`, boxShadow: "0 24px 60px -18px rgba(0,0,0,.7)" });
  shell.appendChild(g);
  document.body.appendChild(shell);
  const k = b.width / a.width;
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  // the cover on the stage gives as its copy leaves
  stage.animate([{ transform: "scale(1)" }, { transform: "scale(.965)" }, { transform: "scale(1)" }], { duration: 420, easing: SPRING });
  shell.animate([{ transform: "translateX(0)" }, { transform: `translateX(${dx}px)` }], { duration: 640, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
  const flight = g.animate(
    [
      { transform: "translateY(0) scale(1)", borderRadius: `${r}px` },
      { transform: "translateY(-14px) scale(1.04)", borderRadius: `${r}px`, offset: 0.16 },
      { transform: `translateY(${dy}px) scale(${k})`, borderRadius: `${rt / k}px` },
    ],
    { duration: 640, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" },
  );
  return flight.finished
    .then(() => {
      target.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 480, easing: SPRING });
      return g.animate(
        [{ transform: `translateY(${dy}px) scale(${k})`, opacity: 1 }, { transform: `translateY(${dy}px) scale(${k * 0.35})`, opacity: 0 }],
        { duration: 180, easing: "cubic-bezier(.5,0,.9,.4)", fill: "forwards" },
      ).finished;
    })
    .then(() => shell.remove(), () => shell.remove());
}

function Menu({ trackIds, onDone, from, leaving }: Omit<Props, "open"> & { leaving: boolean }) {
  const lists = useLive(() => db.playlists.toArray(), [], []) ?? [];
  const sorted = useMemo(() => [...lists].sort((a, b) => a.name.localeCompare(b.name, "ru")), [lists]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // the playlist being added to
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [out, setOut] = useState(false); // leaving on its own: Escape, a click outside, after an add
  const [, known] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const covers = sorted.map((p) => p.coverImageId as string | null | undefined).filter(Boolean).join();
  useEffect(() => { void warmFromMirror(covers.split(",")).then(() => known((n) => n + 1)); }, [covers]);

  const close = (after = 0) => {
    if (closing.current) return;
    closing.current = true;
    setTimeout(() => { setOut(true); setTimeout(onDone, reduced() ? 0 : LEAVE_MS); }, after);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    const down = (e: PointerEvent) => {
      const anchor = box.current?.closest("[data-pop-anchor]") ?? box.current;
      if (anchor && !anchor.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, []);

  /** Adds, and meanwhile the cover flies: the server answers while it is in the air. */
  async function add(id: string, target: Element | null, make?: () => Promise<string>) {
    if (busy || done) return;
    setBusy(id);
    setError("");
    const landing = flyInto(from?.() ?? null, target);
    try {
      await addToPlaylist(make ? await make() : id, trackIds);
    } catch {
      setBusy(null);
      setError("Не получилось — попробуй ещё раз");
      return;
    }
    await landing;
    setBusy(null);
    setDone(id);
    close(from ? 620 : 380); // long enough to see the mark
  }

  return (
    <div ref={box} className={css.menu + (leaving || out ? " " + css.out : "")} role="dialog" aria-label="Добавить в плейлист">
      <div className={css.head}>В плейлист</div>
      <ul className={css.list}>
        {sorted.map((p, n) => {
          const cover = p.coverImageId as string | null | undefined;
          return (
            <li key={p.id} style={{ ["--n" as string]: Math.min(n, 8) }}>
              <button type="button" disabled={!!busy || !!done} className={css.row} onClick={(e) => void add(p.id, e.currentTarget.querySelector("[data-thumb]"))}>
                <span className={css.thumb} data-thumb>{cover ? <Cover id={cover} size={32} radius={8} /> : <Icon name="List" size={15} />}</span>
                <span className={css.name}>{p.name}</span>
                {done === p.id
                  ? <svg className={css.check} width="18" height="18" viewBox="0 0 24 24" aria-label="Добавлено"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <span className={css.count}>{p.itemCount}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <form className={css.new} onSubmit={(e) => {
        e.preventDefault();
        const title = name.trim();
        if (title) void add("new", e.currentTarget.querySelector("input"), () => createPlaylist(title));
      }}>
        <input className={controls.field} placeholder="Новый плейлист" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название нового плейлиста" />
        <button type="submit" className={controls.ghost} disabled={!!busy || !!done || !name.trim()}>Создать</button>
      </form>
      {error && <div className={controls.error}>{error}</div>}
    </div>
  );
}
