import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { uploadFile, type Progress } from "../../api/upload";
import { Icon } from "../../ui/icons";
import css from "./upload.module.css";

export const Route = createFileRoute("/_app/upload")({ component: Upload });

const AUDIO = /\.(flac|mp3|m4a|aac|ogg|opus|wav|aiff?|alac|wv|ape)$/i;
type Row = { name: string; size: number; p: Progress };

/** Drag files in: each is hashed, sent in resumable chunks, and turns into tracks once the
 *  server has verified and tagged it (the library updates by itself over the WebSocket). */
function Upload() {
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);

  async function add(files: FileList | File[]) {
    const list = [...files].filter((f) => AUDIO.test(f.name));
    const start = rows.length;
    setRows((r) => [...r, ...list.map((f) => ({ name: f.name, size: f.size, p: { phase: "hash" as const, fraction: 0 } }))]);
    for (const [i, f] of list.entries()) {
      const at = start + i;
      const update = (p: Progress) => setRows((r) => r.map((x, k) => (k === at ? { ...x, p } : x)));
      try {
        await uploadFile(f, update);
      } catch (e) {
        update({ phase: "error", fraction: 0, error: (e as Error).message });
      }
    }
  }

  return (
    <div className={css.page}>
      <h1 className={css.title}>Загрузка музыки</h1>
      <p className={css.sub}>FLAC, ALAC, MP3, AAC, Opus, WAV — до 2 ГБ на файл. Одинаковые файлы не загружаются дважды.</p>
      <label className={over ? css.dropOn : css.drop}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}>
        <Icon name="Upload" size={34} />
        <span className={css.dropTitle}>Перетащи файлы или папку сюда</span>
        <span className={css.dropSub}>или нажми, чтобы выбрать</span>
        <input type="file" multiple accept="audio/*,.flac,.m4a,.alac,.ape,.wv" onChange={(e) => e.target.files && void add(e.target.files)} />
      </label>
      {rows.length > 0 && (
        <ol className={css.list}>
          {rows.map((r, i) => (
            <li key={i} className={css.row}>
              <span className={css.name}>{r.name}</span>
              <span className={css.state}>
                {{ hash: "проверяю", send: "загружаю", verify: "обрабатываю на сервере", done: "уже в библиотеке", error: `ошибка: ${r.p.error}` }[r.p.phase]}
                {(r.p.phase === "hash" || r.p.phase === "send") && ` · ${Math.round(r.p.fraction * 100)}%`}
              </span>
              <span className={css.bar} style={{ ["--p" as string]: String(r.p.phase === "verify" || r.p.phase === "done" ? 1 : r.p.fraction) }} data-phase={r.p.phase} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
