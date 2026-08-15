import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" (not "autoUpdate") so a found update sits waiting instead of
      // silently reloading the tab out from under the user — src/main.tsx +
      // UpdateBanner.tsx decide exactly when to apply it (next safe interaction).
      registerType: "prompt",
      // Registration is done by hand in main.tsx so we can poll for updates on an
      // already-open tab (the default auto-injected registerSW.js only checks once
      // per page load, which is why devices kept serving a stale build until a full
      // reload/reinstall).
      injectRegister: false,
      // Time-of-day scenes are local fallbacks as well as the default visual
      // source, so keep all four available when the installed PWA is offline.
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "backgrounds/*.jpg"],
      workbox: {
        // Loads push-sw.js's push/notificationclick listeners into the existing
        // generateSW-mode service worker via a plain importScripts() call — the
        // precache/update-banner machinery above is untouched, no need to switch
        // to injectManifest mode just for background push notifications.
        importScripts: ["push-sw.js"],
      },
      manifest: {
        name: "LIFE HUB",
        short_name: "LIFE HUB",
        description: "生活を一元管理するダッシュボード",
        theme_color: "#4F46E5",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
          },
          {
            src: "icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
          },
        ],
      },
    }),
  ],
});
