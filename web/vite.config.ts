import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { serviceWorker } from "./sw.plugin";

// Dev: the page, /api (and the WebSocket) and the signed media all come through this
// server, so audio is same-origin (a GainNode on a cross-origin element outputs silence).
const API = process.env.MUSIX_API ?? "http://127.0.0.1:18010"; // api-snap: the migrated data
const MEDIA = process.env.MUSIX_MEDIA ?? "http://127.0.0.1:18080"; // the dev nginx (/m, /i)

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), serviceWorker()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: { allow: [".."] }, // design/gen/web/tokens.css
    proxy: {
      "/api": { target: API, ws: true, changeOrigin: true },
      "/m/": { target: MEDIA, changeOrigin: true },
      "/i/": { target: MEDIA, changeOrigin: true },
    },
  },
  build: { target: "es2023", sourcemap: true, manifest: true },
});
