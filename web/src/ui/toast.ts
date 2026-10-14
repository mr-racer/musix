import glass from "./glass.module.css";

/** A glass pill above the mini player that says what just happened and goes (the settings and
 *  the library's «Добавить», design/reference/settings). One at a time: a new one replaces it. */
let cur: HTMLElement | null = null;

export function toast(text: string): void {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (cur) cur.remove();
  const t = document.createElement("div");
  t.className = glass.lg!;
  t.setAttribute("role", "status");
  t.style.cssText = "position:fixed;left:50%;bottom:calc(var(--player-h, 0px) + var(--spec-room, 0px) + 28px);z-index:80;transform:translateX(-50%);padding:12px 18px;border-radius:999px;font:500 14px/1.2 var(--mx-font-sans);white-space:nowrap;color:var(--glass-ink);pointer-events:none";
  t.textContent = text;
  document.body.append(t);
  cur = t;
  if (!still) t.animate([{ opacity: 0, transform: "translate(-50%, 12px) scale(.94)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)" });
  setTimeout(() => {
    if (cur !== t) return;
    const gone = () => { t.remove(); if (cur === t) cur = null; };
    if (still) return gone();
    t.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(-50%, 8px) scale(.96)" }], { duration: 220, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).onfinish = gone;
  }, 2600);
}
