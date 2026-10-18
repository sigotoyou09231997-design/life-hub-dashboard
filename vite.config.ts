import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/** Emits dist/version.json with an id unique to this deploy — Netlify's COMMIT_REF
 * (falling back to Vercel's equivalent, then a timestamp for a plain local build).
 * netlify/functions/checkAppUpdate.ts polls this file on the live site and compares
 * it to the last-seen value to detect a new deploy and push an "アップデートしました"
 * notification, independent of (and a background counterpart to) the in-tab update
 * check in src/main.tsx/UpdateBanner.tsx, which only fires while a tab is open. Only
 * meaningful for `vite build` — dev has no deploys to detect. */
function writeVersionFile(): Plugin {
  return {
    name: "write-version-file",
    generateBundle() {
      const version = process.env.COMMIT_REF || process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_ID || String(Date.now());
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version }) });
    },
  };
}

/** 動いているアプリの版。要望の受信箱(src/lib/appFeedback.ts)に「どの版で見て書いたか」を添える。 */
const APP_COMMIT = process.env.COMMIT_REF || process.env.VERCEL_GIT_COMMIT_SHA || "dev";

export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
  },
  plugins: [
    writeVersionFile(),
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
      includeAssets: ["favicon.svg", "favicon-32.png", "apple-touch-icon.png", "backgrounds/*.jpg"],
      workbox: {
        // Loads push-sw.js's push/notificationclick listeners into the existing
        // generateSW-mode service worker via a plain importScripts() call — the
        // precache/update-banner machinery above is untouched, no need to switch
        // to injectManifest mode just for background push notifications.
        importScripts: ["push-sw.js"],
        // 数字用の文字(UI/UX 調査メモ 第4弾 B-1、index.html で Google Fonts から読む)を、
        // 一度読んだら端末に取り置く。このアプリは電波の無い所でも開く PWA なので、
        // 外の配信に毎回取りに行くと、地下や機内で数字だけ端末の文字に戻ってしまう。
        // CSS の URL は text= の中身で決まった固定の文字列、フォントの URL も版ごとに変わるので、
        // どちらも「取り置きが先」(CacheFirst)でよい。CSS は no-cors で読む(opaque = 0)ので 0 も取り置く。
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "LIFE HUB",
        short_name: "LIFE HUB",
        description: "生活を一元管理するダッシュボード",
        theme_color: "#121416",
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
        // アプリアイコンの長押し(iOSはホーム画面、Androidはランチャー)から出る近道。
        // 行き先の ?new=... は App 側で受けて、その画面を開いた直後にフォームを開く
        // (SchedulePage.tsx / records/ExpensePage.tsx / records/NotePage.tsx)。印は開いた時点で消すので、
        // 戻る・再読み込みでフォームが開き直すことはない。
        // アイコンは付けない — このアプリの手持ちはSVGだけで、ショートカットの
        // アイコンにSVGを使えない環境があり、その場合は指定ごと無視されるより
        // アプリ本体のアイコンで代替される方が確実なため。
        shortcuts: [
          { name: "支出を追加", short_name: "支出", url: "/records/expense?new=expense" },
          { name: "予定を追加", short_name: "予定", url: "/schedule?new=event" },
          { name: "タスクを追加", short_name: "タスク", url: "/schedule?new=task" },
          // まとめて検索の「メモを書く」と同じ行き先(src/lib/commandPalette.ts)。
          { name: "メモを書く", short_name: "メモ", url: "/records/notes?new=note" },
        ],
      },
    }),
  ],
});
