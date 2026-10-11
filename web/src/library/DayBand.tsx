import { mediaUrl } from "../api/client";
import { image, imageUrl } from "../lib/images";
import { plural } from "../lib/format";
import { Icon } from "../ui/icons";
import { openFrom, playAlbum } from "./actions";
import type { AlbumCard, Summary } from "./model";
import css from "./library.module.css";

/** «Пластинка дня»: an album loved and left (played 8+ times, untouched the longest; the
 *  server picks it, so every device shows the same one). Its own band above the groups,
 *  never inside one; lit by its cover as the player is; the sleeve bigger than a tile, its
 *  record peeking out. */
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const day = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]}`;

export function DayBand({ pick, albums }: { pick: Summary["dayPick"]; albums: Map<string, AlbumCard> }) {
  const a = pick ? albums.get(pick.albumId) : undefined;
  if (!pick || !a) return null;
  const img = image(a.cover), pal = img?.palette;
  const bg = img?.urls.bg ? mediaUrl(img.urls.bg) : imageUrl(a.cover, 96);
  const label = `radial-gradient(circle at 38% 32%, ${pal?.vibrant ?? "#888"}, ${pal?.accent.dark ?? "#444"} 72%)`;
  const min = Math.round(a.ms / 60000);
  return (
    <section className={css.dayband} style={{ ["--day-acc" as string]: pal?.accent.light ?? "#f0b85a" }}>
      <div className={css.lit} style={{ backgroundImage: bg ? `url(${bg})` : undefined }} />
      <div className={css.sl} onClick={(e) => openFrom(a.id, a.cover, e.currentTarget, false)}>
        <span className={css.vinyl}><i style={{ background: label }} /></span>
        <img src={imageUrl(a.cover, 512) ?? undefined} alt="" />
      </div>
      <div className={css.dtx}>
        <span className={css.dl}>Пластинка дня<small>{day(new Date())}</small></span>
        <h2>{a.title}</h2>
        <span className={css.dar}><span className={css.link}>{a.artist}</span>{a.year ? ` · ${a.year}` : ""}</span>
        <p className={css.why}>Ты слушал его <b>{pick.plays} {plural(pick.plays, "раз", "раза", "раз")}</b>, но не ставил с {day(new Date(pick.lastPlayedAt))}.</p>
        <span className={css.facts}>{a.n} {plural(a.n, "песня", "песни", "песен")} · {min} мин · {a.genre}</span>
        <div className={css.acts}>
          <button type="button" className={css.btnPlay} onClick={(e) => void playAlbum(a.id, e.currentTarget.closest("section")?.querySelector("img") ?? null)}><Icon name="Play" size={14} />Слушать</button>
          <button type="button" className={css.btnSoft} onClick={(e) => openFrom(a.id, a.cover, e.currentTarget.closest("section")?.querySelector("img") ?? null, false)}>Открыть разворот</button>
        </div>
      </div>
    </section>
  );
}
