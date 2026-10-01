import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootstrap, onAccountChange, onBeforeSignOut, useAuth } from "./api/auth";
import { guard } from "./api/db";
import { connect, disconnect, subscribe } from "./api/realtime";
import { sync } from "./api/sync";
import "./player/handoff"; // «Слушать на…»: a tab can be handed the music before the player is opened
import { routeTree } from "./routeTree.gen";
import "./styles/fonts";
import "./styles/global.css";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// sign-out: the playing track's listen is ended and everything queued is sent first
onBeforeSignOut(async () => {
  const [{ player }, { flush }] = await Promise.all([import("./player/engine"), import("./player/outbox")]);
  await player.stop();
  await flush();
});
// account change = nothing of the previous account survives (mirror, cache, socket)
onAccountChange(async (id) => {
  disconnect();
  queryClient.clear();
  await guard(id);
});
useAuth.subscribe((s, prev) => {
  if (s.status === prev.status) return;
  if (s.status === "in") {
    connect();
    void sync().catch(() => undefined);
  }
  void router.invalidate();
});
subscribe((e) => {
  if (e.type === "sync.changed") void sync().then(() => queryClient.invalidateQueries({ queryKey: ["mirror"] }));
  if (e.type === "instance.status") void queryClient.invalidateQueries({ queryKey: ["instance"] });
});

void bootstrap();
if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.register("/sw.js");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.DEV) {
  // dev-only handle for the Playwright checks (never in a production build)
  void import("./player/engine").then((m) => Object.assign(window, { __musix: { player: m.player, usePlayer: m.usePlayer } }));
}
