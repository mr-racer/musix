import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { mediaUrl, type Schemas } from "../api/client";
import { image, imageUrl } from "../lib/images";
import { Icon } from "../ui/icons";
import css from "./settings.module.css";

/** The phone banner (design/reference/settings, round 2): one horizontal banner on top, lit by
 *  the listener's favourite song (its backdrop, its accent; the phone plays it), a white QR
 *  sticker that copies the link on click, and the phone cut by the banner's bottom edge. It
 *  folds into one line; it starts folded once the account has an Android device (the owner,
 *  2026-10-14). The QR encoder is fetched only when the banner is open. */

type Fav = Schemas["TrackOut"] | null | undefined;
const KEY = "musix.promo";
const SPEC = [30, 52, 70, 88, 76, 64, 58, 72, 60, 48, 52, 40, 34, 44, 30, 22, 26, 18, 14, 10];
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPRING = "cubic-bezier(.34,1.56,.64,1)", STD = "cubic-bezier(.22,.9,.3,1)";

function readFold(): "open" | "slim" | null {
  try { return localStorage.getItem(KEY) as "open" | "slim" | null; } catch { return null; }
}

export function Promo({ fav, app, androidHere }: { fav: Fav; app: Schemas["AppRelease"] | null | undefined; androidHere: boolean }) {
  const [slim, setSlim] = useState(() => (readFold() ?? (androidHere ? "slim" : "open")) === "slim");
  const phone = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), qr = useRef<HTMLButtonElement>(null);
  const url = app ? new URL(app.url, location.origin).href : `${location.origin}/download/musix.apk`;
  const img = image(fav?.coverImageId);
  const bg = img?.urls.bg ? mediaUrl(img.urls.bg) : imageUrl(fav?.coverImageId, 512);
  const cover = imageUrl(fav?.coverImageId, 512);
  const size = app?.sizeBytes ? `${(app.sizeBytes / 1048576).toFixed(1).replace(".", ",")} МБ` : null;

  function fold(to: boolean) {
    setSlim(to);
    try { localStorage.setItem(KEY, to ? "slim" : "open"); } catch { /* private mode */ }
    if (!to) setTimeout(phoneIn, 120);
  }
  function phoneIn() {
    const p = phone.current;
    if (!p || reduce()) return;
    const ps = getComputedStyle(p).getPropertyValue("--ps").trim() || "1";
    p.animate([{ transform: `translateY(90px) rotateY(-30deg) rotateX(18deg) rotateZ(-10deg) scale(${ps})`, opacity: 0 }, { opacity: 1, offset: 0.3 },
      { transform: `rotateY(-14deg) rotateX(10deg) rotateZ(-6deg) scale(${ps})`, opacity: 1 }], { duration: 1000, easing: SPRING, delay: 150 });
    qr.current?.animate([{ transform: "translateY(24px) rotate(10deg) scale(.9)", opacity: 0 }, { transform: "rotate(3deg)", opacity: 1 }], { duration: 800, easing: SPRING, delay: 420, fill: "backwards" });
  }
  useLayoutEffect(() => { if (!slim) phoneIn(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the phone tilts toward the pointer, like the player's cover
  const raf = useRef(0);
  function tilt(e: React.PointerEvent) {
    const p = phone.current, st = stage.current;
    if (!p || !st || reduce()) return;
    const r = st.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      p.classList.add(css.live!);
      p.style.setProperty("--ry", `${-10 + x * 18}deg`); p.style.setProperty("--rx", `${8 - y * 8}deg`);
      p.style.setProperty("--gx", `${80 - x * 60}%`); p.style.setProperty("--gl", ".16");
    });
  }
  function untilt() {
    const p = phone.current;
    if (!p) return;
    cancelAnimationFrame(raf.current);
    p.classList.remove(css.live!);
    for (const k of ["--ry", "--rx", "--gx", "--gl"]) p.style.removeProperty(k);
  }

  return (
    <div className={css.promo} data-slim={slim ? "" : undefined}>
      <div className={css.promoBig} inert={slim}>
        <div className={css.promoIn}>
          <Backdrop src={bg} />
          <div className={css.ptext}>
            <h3>А ещё можно кайфовать и&nbsp;на&nbsp;телефоне</h3>
            <p>Та же библиотека, «Поток» и статистика доступны на Android — с бесшовным прослушиванием любимых песен.</p>
            <div className={css.meta}><span>Android 7+</span>{app && <span>версия {app.versionName}</span>}{size && <span>{size}</span>}</div>
            <a className={css.dlPhone} href={url}>Скачать MusiX</a>
          </div>
          <Qr ref={qr} url={url} />
          <div ref={stage} className={css.stagep} onPointerMove={tilt} onPointerLeave={untilt}>
            <div ref={phone} className={css.phone}>
              <div className={css.scr}>
                <Backdrop src={bg} phone />
                <span className={css.isl} />
                <div className={css.pc}>
                  {cover ? <Develop src={cover} /> : <span className={css.pcover} />}
                  <div className={css.pt}>{fav?.titleDisplay ?? fav?.title ?? "Твоя любимая песня"}</div>
                  <div className={css.pa}>{fav?.artistDisplay ?? "MusiX"}</div>
                  <div className={css.spec}>{SPEC.map((h, i) => <i key={i} style={{ ["--h" as string]: h }} />)}</div>
                  <div className={css.seek} />
                  <div className={css.ctr}><Icon name="Prev" size={18} /><span className={css.pp}><Icon name="Pause" size={18} /></span><Icon name="Next" size={18} /></div>
                </div>
              </div>
            </div>
          </div>
          <button type="button" className={css.pfold} aria-label="Свернуть баннер" onClick={() => fold(true)}><Icon name="ChevronDown" size={18} /></button>
        </div>
      </div>
      <div className={css.promoSlim} inert={!slim}>
        <div className={css.slimIn}>
          <span className={css.slimIc}><Icon name="Phone" size={18} /></span>
          <span className={css.slimT}><b>MusiX для Android</b><span>{[app && `версия ${app.versionName}`, size].filter(Boolean).join(" · ")}</span></span>
          <button type="button" className={css.qbtn} onClick={() => fold(false)}>Показать код</button>
        </div>
      </div>
    </div>
  );
}

/** The banner's light: the colour is there at once (the accent under the gradient), the
 *  backdrop develops over it when it has arrived. */
function Backdrop({ src, phone }: { src: string | null; phone?: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    const im = new Image();
    im.decoding = "async";
    im.src = src;
    let live = true;
    im.decode().then(() => live && setShown(src), () => live && setShown(src));
    return () => { live = false; };
  }, [src]);
  return <div className={phone ? css.pbg2 : css.pbg} data-in={shown ? "" : undefined} style={shown ? { backgroundImage: `url(${shown})` } : undefined} />;
}

/** A cover that develops: blurred and grey while it arrives, sharp when it has. */
function Develop({ src }: { src: string }) {
  const [ok, setOk] = useState(false);
  return <img className={css.pcover} src={src} alt="" decoding="async" data-in={ok ? "" : undefined} onLoad={() => setOk(true)} />;
}

/** The white sticker: rounded dots instead of squares, rounded eyes, the mark in the middle
 *  (level H survives it). A wave runs through the dots on hover; a click copies the link. */
function Qr({ url, ref }: { url: string; ref: React.Ref<HTMLButtonElement> }) {
  const [m, setM] = useState<{ n: number; dark: (r: number, c: number) => boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const waved = useRef(0);
  useEffect(() => {
    let live = true;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      const q = qrcode(0, "H");
      q.addData(url);
      q.make();
      if (live) setM({ n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) });
    });
    return () => { live = false; };
  }, [url]);

  const dots: React.ReactNode[] = [];
  if (m) {
    const { n } = m, lo = Math.floor(n / 2) - 3, hi = Math.floor(n / 2) + 3;
    const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!m.dark(r, c) || finder(r, c) || (r >= lo && r <= hi && c >= lo && c <= hi)) continue;
      dots.push(<circle key={`${r}.${c}`} className={css.qd} cx={c + 0.5} cy={r + 0.5} r=".43" fill="currentColor" data-r={Math.hypot(r - n / 2, c - n / 2).toFixed(1)} />);
    }
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      dots.push(<rect key={`e${r}.${c}`} x={c + 0.5} y={r + 0.5} width="6" height="6" rx="1.9" fill="none" stroke="currentColor" strokeWidth="1" />);
      dots.push(<rect key={`i${r}.${c}`} x={c + 2} y={r + 2} width="3" height="3" rx="1" fill="currentColor" />);
    }
    const s = hi - lo + 1;
    dots.push(<rect key="logo" x={lo + 0.3} y={lo + 0.3} width={s - 0.6} height={s - 0.6} rx="1.8" fill="#221c4a" />);
    [[0.9, 1.6], [2.1, 2.9], [3.3, 4.0], [4.5, 2.6], [5.7, 1.3]].forEach(([x, h], k) =>
      dots.push(<rect key={`b${k}`} x={lo + x!} y={lo + s / 2 - h! / 2} width=".55" height={h} rx=".27" fill="#b9a8ff" />));
  }

  function wave() {
    if (reduce() || Date.now() - waved.current < 1400 || !svg.current) return;
    waved.current = Date.now();
    for (const d of svg.current.querySelectorAll<SVGCircleElement>("circle")) {
      d.animate([{ transform: "scale(1)" }, { transform: "scale(.35)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 520, delay: Number(d.dataset.r) * 26, easing: STD });
    }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); } catch { /* no clipboard: the code still works */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button ref={ref} type="button" className={css.qr} aria-label="Скопировать ссылку на APK" data-copied={copied ? "" : undefined} onPointerEnter={wave} onClick={() => void copy()}>
      <svg ref={svg} viewBox={m ? `-0.5 -0.5 ${m.n + 1} ${m.n + 1}` : "0 0 10 10"} data-in={m ? "" : undefined}>{dots}</svg>
      <div className={css.qcap}>Наведи камеру<span>или нажми — скопирую ссылку</span></div>
      <div className={css.copied}>Ссылка скопирована</div>
    </button>
  );
}
