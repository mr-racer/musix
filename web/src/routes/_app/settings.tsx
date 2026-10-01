import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { logout } from "../../api/auth";
import { api, ok } from "../../api/client";
import { db } from "../../api/db";
import { readSettings, setSetting, type Settings } from "../../api/settings";
import { useLive } from "../../lib/live";
import { setThemePref, themePref, useTheme, type ThemePref } from "../../lib/theme";
import { Segmented } from "../../ui/controls";
import css from "./settings.module.css";

export const Route = createFileRoute("/_app/settings")({ component: SettingsView });

const TIERS = [{ value: "economy", label: "Эконом" }, { value: "high", label: "Высокое" }, { value: "lossless", label: "Lossless" }];

/** v1's settings panel as one quiet column: playback, the look, devices, the account. */
function SettingsView() {
  const s = useLive(readSettings, [], {} as Settings) ?? {};
  useTheme(); // re-render on a theme change
  const pref = themePref();
  const nav = useNavigate();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => ok(api.GET("/api/v2/devices")) });
  const cacheRows = useLive(() => db.tracks.count(), [], 0);
  const apps = useQuery({ queryKey: ["apps"], queryFn: async () => {
    const one = async (platform: "android" | "windows") => (await api.GET("/api/v2/app/{platform}/latest", { params: { path: { platform } } })).data ?? null;
    return { android: await one("android"), windows: await one("windows") };
  }, staleTime: 3_600_000 });

  return (
    <div className={css.page}>
      <h1 className={css.title}>Настройки</h1>

      <section className={css.card}>
        <div className={css.eyebrow}>Воспроизведение</div>
        <Row label="Качество по Wi-Fi"><Segmented label="Качество по Wi-Fi" value={s.quality?.wifi ?? "lossless"} options={TIERS} onChange={(v) => void setSetting(["quality", "wifi"], v)} /></Row>
        <Row label="Качество в мобильной сети" hint="Браузер сообщает тип сети не везде — тогда действует Wi-Fi"><Segmented label="Качество в мобильной сети" value={s.quality?.cellular ?? "high"} options={TIERS} onChange={(v) => void setSetting(["quality", "cellular"], v)} /></Row>
        <Row label="Выравнивать громкость" hint="Все треки звучат одинаково громко (−14 LUFS)">
          <label className={css.switch}>
            <input type="checkbox" checked={s.playback?.normalize ?? true} onChange={(e) => void setSetting(["playback", "normalize"], e.target.checked)} />
            <span />
          </label>
        </Row>
      </section>

      <section className={css.card}>
        <div className={css.eyebrow}>Вид</div>
        <Row label="Тема"><Segmented<ThemePref> label="Тема" value={pref} onChange={setThemePref} options={[{ value: "system", label: "Как в системе" }, { value: "dark", label: "Тёмная" }, { value: "light", label: "Светлая" }]} /></Row>
      </section>

      <section className={css.card}>
        <div className={css.eyebrow}>Устройства</div>
        {(devices.data ?? []).map((d) => (
          <div key={d.id} className={css.device}>
            <span>
              <span className={css.deviceName}>{d.name}{d.current && <em> · это устройство</em>}</span>
              <span className={css.deviceSub}>{d.platform} · был {new Date(d.lastSeenAt).toLocaleDateString("ru")}</span>
            </span>
            {!d.current && (
              <button type="button" className={css.revoke} onClick={async () => { await ok(api.DELETE("/api/v2/devices/{device_id}", { params: { path: { device_id: d.id } } })); void qc.invalidateQueries({ queryKey: ["devices"] }); }}>Отключить</button>
            )}
          </div>
        ))}
      </section>

      <section className={css.card}>
        <div className={css.eyebrow}>Музыка</div>
        <Row label="Загрузить файлы с компьютера"><Link to="/upload" className={css.link}>Открыть →</Link></Row>
        <Row label="Импорт из Яндекс Музыки"><Link to="/import" className={css.link}>Открыть →</Link></Row>
        <Row label="В этом браузере" hint="Копия библиотеки для мгновенного открытия">{(cacheRows ?? 0).toLocaleString("ru")} треков</Row>
      </section>

      {(apps.data?.android || apps.data?.windows) && (
        <section className={css.card}>
          <div className={css.eyebrow}>Приложения</div>
          {apps.data.android && <Row label="Android" hint={`Версия ${apps.data.android.versionName}`}><a href={apps.data.android.url} className={css.link}>Скачать APK →</a></Row>}
          {apps.data.windows && <Row label="Windows" hint={`Версия ${apps.data.windows.versionName} · обновляется само`}><a href={apps.data.windows.url} className={css.link}>Скачать установщик →</a></Row>}
        </section>
      )}

      <section className={css.card}>
        <div className={css.eyebrow}>Аккаунт</div>
        <button type="button" className={css.signout} onClick={async () => { await logout(); void nav({ to: "/login" }); }}>Выйти из аккаунта</button>
      </section>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={css.row}>
      <span className={css.label}>{label}{hint && <span className={css.hint}>{hint}</span>}</span>
      <span className={css.control}>{children}</span>
    </div>
  );
}
