import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ok, type Schemas } from "../../api/client";
import { statsQuery } from "../../api/queries";
import { readSettings, type Settings } from "../../api/settings";
import { image, remember } from "../../lib/images";
import { useLive } from "../../lib/live";
import { Account } from "../../settings/Account";
import { Options, type Tab, TABS } from "../../settings/Options";
import { Promo } from "../../settings/Promo";
import css from "../../settings/settings.module.css";

/** The settings (design/reference/settings, approved 2026-10-14 after two rounds): open space,
 *  no cards. On top the one object, the phone banner lit by the listener's favourite song;
 *  under it the account; then the options as tabs. Adding music lives in the library now,
 *  the theme is its own button beside the gear (ui/ThemeButton.tsx). */

const meQuery = queryOptions({ queryKey: ["me"], queryFn: () => ok(api.GET("/api/v2/me")), staleTime: 3_600_000 });
const devicesQuery = queryOptions({ queryKey: ["devices"], queryFn: () => ok(api.GET("/api/v2/devices")) });
const appQuery = queryOptions({
  queryKey: ["app", "android"],
  queryFn: async () => (await api.GET("/api/v2/app/{platform}/latest", { params: { path: { platform: "android" } } })).data ?? null,
  staleTime: 3_600_000,
});

/** The favourite song is kept here between visits (its image urls are content-addressed and
 *  signed for a year): the banner is lit from the first frame, /stats only refreshes it. */
type Fav = { track: Schemas["TrackOut"]; img?: Schemas["ImageData"] };
const FAV = "musix.fav";
function cachedFav(): Fav | null {
  try {
    const f = JSON.parse(localStorage.getItem(FAV) ?? "null") as Fav | null;
    if (f?.img && f.track.coverImageId) remember({ [f.track.coverImageId]: f.img });
    return f;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/_app/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: TABS.some(([k]) => k === s.tab) ? (s.tab as Tab) : undefined }),
  loader: async ({ context }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery(meQuery);
    void qc.prefetchQuery(appQuery);
    if (!qc.getQueryData(statsQuery.queryKey)) setTimeout(() => void qc.prefetchQuery(statsQuery), 600); // after the page change
    // the banner's fold depends on an Android device being there: known before the first frame
    await Promise.race([qc.ensureQueryData(devicesQuery).catch(() => undefined), new Promise((r) => setTimeout(r, 500))]);
  },
  component: SettingsView,
});

function SettingsView() {
  const search = Route.useSearch();
  const nav = useNavigate({ from: "/settings" });
  // the tab is the page's own state (the switch animates against it), mirrored into the address
  const [tab, setTab] = useState<Tab>(search.tab ?? "sound");
  const s = useLive(readSettings, [], {} as Settings) ?? {};
  const me = useQuery(meQuery).data;
  const devices = useQuery(devicesQuery).data;
  const app = useQuery(appQuery).data;
  const stats = useQuery({ ...statsQuery, enabled: false }).data; // the loader asks, once the page has changed
  const top = stats?.listening.topTrack?.track;
  const fav = top ? { track: top } : cachedFav();
  useEffect(() => {
    if (!top) return;
    const img = top.coverImageId ? image(top.coverImageId) : undefined;
    try { localStorage.setItem(FAV, JSON.stringify({ track: top, img: img && { urls: img.urls, blurhash: img.blurhash, palette: img.palette } })); } catch { /* private mode */ }
  }, [top]);
  const acc = image(fav?.track.coverImageId)?.palette?.accent.dark ?? "hsl(351, 72%, 52%)";

  return (
    <div className={css.page} style={{ ["--fav" as string]: acc }}>
      <div className={css.in}>
        <header className={css.head}><h1>Настройки</h1></header>
        <Promo fav={fav?.track} app={app} androidHere={(devices ?? []).some((d) => d.platform === "android")} />
        <Account me={me} />
        <Options s={s} tab={tab} devices={devices} setTab={(t) => { setTab(t); void nav({ search: { tab: t === "sound" ? undefined : t }, replace: true, resetScroll: false }); }} />
      </div>
      <div className={css.veil} aria-hidden />
    </div>
  );
}
