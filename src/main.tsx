import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installPressFeedback } from "./lib/pressFeedback";
import { currentVersion, markUpdateAvailable, setUpdateApplier, setUpdateChecker } from "./lib/pwaUpdate";
import { installLifecycleLogging } from "./lib/lifecycleLog";
import { trackViewportGap } from "./lib/viewport";
import { installDemoApiGuard, IS_DEMO, IS_DEMO_ENTRY } from "./lib/demoMode";
import "./index.css";
import "./styles/hub.css";
import "./styles/trips.css";
import "./styles/diary.css";
import "./styles/forms.css";
import "./styles/photos.css";
// 暖色・写真ベースの新デザインの土台。既存のCSSを上書きするので必ず最後。
import "./styles/theme-warm.css";
import "./styles/home-warm.css";
import "./styles/pages-warm.css";
import "./styles/event-people.css";
// 白＋青緑の上塗り（2026-10-12）。必ず最後に読む。外すと元の見た目に戻る。
import "./styles/theme-teal.css";
// ホームとお金管理の並び（2026-10-12）。theme-teal.css の後に読む。
import "./styles/layout-teal.css";
// お金管理の「サブスク」タブ(2026-10-12)。layout-teal.css の行の一覧の上に足す。
import "./styles/subscriptions.css";
import "./styles/fixed-costs.css";
// 設定の「海外サッカー」(2026-10-25)。
import "./styles/soccer.css";
import "./styles/ai-news.css";
// 押した感触・アイコンの線の太さ（UI/UX 調査メモ 第4弾 A-1・B-4・B-5）。どの画面にも効くので最後の方に読む。
import "./styles/touch-tokens.css";
// 数字用の文字・数字が動く・空の表示の線画(UI/UX 調査メモ 第4弾 B-1・A-5・B-6)。上の各画面の上に足す。
import "./styles/numbers-empty.css";
// 指の操作(スワイプ・完了の演出・引っ張って更新。UI/UX 調査メモ 第4弾 A-3・A-4・A-7)。
import "./styles/gestures.css";
// 「元に戻す」付きのお知らせ(UI/UX 調査メモ 第4弾 A-2)。
import "./styles/undo-toast.css";
// 参考 UI/UX の上塗り(2026-11-09・見本)。この1行を外せば前の見た目に戻る。
import "./styles/theme-ref.css";
// 静かな白＋柔らかい影(2026-11-26・「A+影」)。上の全部の層の上に塗る。この1行を外せば前の見た目に戻る。
import "./styles/theme-simple.css";
// デモ(/demo)の時だけ出す上の帯(src/components/layout/DemoBanner.tsx)。
import "./styles/demo.css";

// A tab left open never re-checks for updates on its own, so it kept serving a
// stale build until a full reload/reinstall. Polling registration.update()
// (here + on tab refocus) means an already-open session notices new deploys
// without any manual action. registerType: "prompt" (see vite.config.ts) means
// a found update just sits waiting here instead of reloading the tab out from
// under the user — UpdateBanner.tsx shows the banner as soon as it lands and
// applies it a moment later (holding off only while a form is open).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateAvailable();
  },
  onRegisteredSW(_swScriptUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => void registration.update();
    setUpdateChecker(() => registration.update().then(() => undefined));
    setInterval(checkForUpdate, 60_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  },
});
setUpdateApplier(updateSW);

// 起動・裏に回った・戻った・エラーを端末の中に短く残す(iPhone の白い画面の調べもの。src/lib/lifecycleLog.ts)。
installLifecycleLogging(currentVersion());

// index.html の先頭の台本が「真っ白になったので取り置きを捨てて読み込み直した」印を
// 残している。ここまで来た＝立ち上がったので、その印を消す(同じタブで後日また
// 古いHTMLを掴んだ時に、もう一度立て直せるように)。
try {
  sessionStorage.removeItem("lifehub:stale-html-recovered");
} catch {
  // プライベートウィンドウなどで読み書きできなくても、立ち上がりには関係ない。
}

// 画面下に貼りつくもの(追従ボタン・シート・知らせ)の位置直し。iOSが画面の高さを
// 戻し損ねている間だけ、その差を --viewport-gap として配る(src/lib/viewport.ts)。
trackViewportGap();

// ボタン・カード・チップ・タブ・下のナビを押すと沈んで、ばねで戻る（src/lib/pressFeedback.ts）。
installPressFeedback();

function renderApp(): void {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        {/* 表示のエラーで白いまま止まらないように(src/components/AppErrorBoundary.tsx)。 */}
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </BrowserRouter>
    </StrictMode>,
  );
}

/** デモ(src/lib/demoMode.ts)の見本のデータを、画面を出す前に入れる。`/demo` から入った時と、
 * 日付が変わった時(「今日の予定」が古い日付のままにならないように)だけ入れ直す。 */
const DEMO_SEEDED_KEY = "lifehub:demo-seeded-on";
async function prepareDemo(): Promise<void> {
  if (!IS_DEMO) return;
  const today = new Date().toDateString();
  let seededOn: string | null = null;
  try {
    seededOn = window.sessionStorage.getItem(DEMO_SEEDED_KEY);
  } catch {
    // 読めなければ毎回入れ直す。
  }
  if (IS_DEMO_ENTRY || seededOn !== today) {
    const [{ db }, { seedDemoData }] = await Promise.all([import("./db/schema"), import("./lib/demoSeed")]);
    await seedDemoData(db);
    try {
      window.sessionStorage.setItem(DEMO_SEEDED_KEY, today);
    } catch {
      // 同上。
    }
  }
  // `/demo` のままだとルートが無いので、ホームを開いた形にしてから画面を出す。
  if (IS_DEMO_ENTRY) window.history.replaceState(null, "", "/");
}

// デモでは、AI の窓口(本人の料金がかかる)を呼ばせない(src/lib/demoMode.ts)。
installDemoApiGuard();

// 見本のデータが入らなくても、画面は出す(空のデモになるだけ)。
void prepareDemo()
  .catch((error: unknown) => console.error("demo seed failed", error))
  .finally(renderApp);
