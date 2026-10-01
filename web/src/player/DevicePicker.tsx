import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import css from "./DevicePicker.module.css";
import { devicesQuery, transfer, useHandoff } from "./handoff";

const KIND: Record<string, string> = { android: "Телефон", windows: "Компьютер", web: "Браузер" };

/** «Слушать на…»: the account's devices online now; a tap hands the music over. */
export function DevicePicker() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const list = useQuery({ ...devicesQuery, enabled: open, staleTime: 0 }).data ?? [];
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const others = list.filter((d) => !d.current);
  const go = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await transfer(id);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: devicesQuery.queryKey });
    } catch {
      setError("Устройство не ответило");
    } finally {
      setBusy(null);
    }
  };
  return (
    <span className={css.wrap} ref={box}>
      <button type="button" className={css.btn + (open ? " " + css.on : "")} onClick={() => setOpen((o) => !o)} aria-label="Слушать на…" aria-expanded={open} title="Слушать на другом устройстве">
        <Icon name="Devices" />
      </button>
      {open && (
        <div className={css.pop} role="dialog" aria-label="Слушать на…">
          <div className={css.head}>Слушать на…</div>
          <div className={css.row + " " + css.here}><Icon name="Devices" size={16} /><span><b>Этот браузер</b><i>играет здесь</i></span></div>
          {others.map((d) => (
            <button key={d.id} type="button" className={css.row} disabled={!d.canPlay || busy !== null} onClick={() => void go(d.id)}>
              <Icon name="Devices" size={16} />
              <span><b>{d.name}</b><i>{KIND[d.platform] ?? d.platform}{d.active ? " · играет" : d.canPlay ? "" : " · откройте плеер"}</i></span>
              {busy === d.id && <span className={css.spin} />}
            </button>
          ))}
          {others.length === 0 && <p className={css.empty}>Других устройств онлайн нет. Откройте MusiX на телефоне или компьютере — он появится здесь.</p>}
          {error && <p className={css.err}>{error}</p>}
        </div>
      )}
    </span>
  );
}

/** «Играет на …»: the account plays on another device; one tap brings it here. */
export function ElsewhereBar() {
  const remote = useHandoff((s) => s.remote);
  const me = useQuery({ ...devicesQuery, enabled: !!remote?.playing }).data?.find((d) => d.current);
  const there = useQuery({ ...devicesQuery, enabled: !!remote?.playing }).data?.find((d) => d.id === remote?.device);
  if (!remote?.playing || !me) return null;
  return (
    <div className={css.elsewhere} role="status">
      <Icon name="Devices" size={16} />
      <span>Играет на «{there?.name ?? "другом устройстве"}»</span>
      <button type="button" onClick={() => void transfer(me.id)}>Слушать здесь</button>
    </div>
  );
}
