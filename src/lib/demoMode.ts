// デモモード(2026-11-26、本人「GitHub に出す時の見せ方。デモから」)。
//
// `/demo` を開くと、ログインなしで、見本のデータ(src/lib/demoSeed.ts)が入った LIFE HUB を触れる。
// 採用担当など、アカウントを持たない人に見せるための入口。
//
// 【本物のデータには触らない】ための仕掛けは3つだけ:
//   1. 端末の中のDBを別の名前(DEMO_DB_NAME)にする(src/lib/accounts.ts の BOOT_DB_NAME)。
//   2. Supabase を「設定されていない」扱いにする(src/lib/supabase.ts の isSupabaseConfigured)。
//      同期・ログイン・サーバーへの保存は、もともと未設定の時に全部止まる作り。
//   3. ログインの保存場所も別の枠(DEMO_AUTH_SLOT)にする。本物のセッションを読まない・更新しない。
//
// この値は起動時に1回だけ決まる(アカウント切り替えと同じく、変える時はページごと読み直す)。
// デモの印は**そのタブの中だけ**(sessionStorage)。タブを閉じれば終わり、同じ端末のほかのタブや
// ふだんの LIFE HUB はデモにならない(2026-11-26。localStorage だと端末ごとデモに切り替わっていた)。
// ほかの lib を import しないこと(accounts.ts / supabase.ts がここを読むので、輪になる)。

const DEMO_FLAG_KEY = "lifehub:demo";

/** デモで使う端末の中のDBの名前。本物(life-hub / life-hub-<id>)とは必ず別。 */
export const DEMO_DB_NAME = "life-hub-demo";

/** デモで使うログインの保存枠。中身は空のまま(誰もログインしない)。 */
export const DEMO_AUTH_SLOT = "demo";

function isDemoEntryPath(pathname: string): boolean {
  return pathname === "/demo" || pathname === "/demo/";
}

function detect(): { active: boolean; entry: boolean } {
  if (typeof window === "undefined") return { active: false, entry: false };
  const entry = isDemoEntryPath(window.location.pathname);
  // 前の版は印を localStorage に置いていたので、端末のほかのタブ・ふだんの画面までデモになった。
  // その印が残っていても効かないよう、ここで消す(2026-11-26)。
  try {
    window.localStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // 消せなくても、下で見るのは sessionStorage だけなので害はない。
  }
  try {
    if (entry) window.sessionStorage.setItem(DEMO_FLAG_KEY, "1");
    return { active: entry || window.sessionStorage.getItem(DEMO_FLAG_KEY) === "1", entry };
  } catch {
    // sessionStorage が使えない環境では、デモは /demo を開いた時だけ。
    return { active: entry, entry };
  }
}

const detected = detect();

/** いまデモで動いているか。 */
export const IS_DEMO: boolean = detected.active;

/** `/demo` から入ってきた直後か(見本のデータを入れ直してからホームへ移る)。 */
export const IS_DEMO_ENTRY: boolean = detected.entry;

/** デモを終えて、ふだんの LIFE HUB(ログイン画面)に戻る。デモのDBは消す(次に入った時は入れ直す)。 */
export function exitDemo(): void {
  try {
    window.sessionStorage.removeItem(DEMO_FLAG_KEY);
    window.localStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // 書けなくても、下の読み直しで /demo 以外を開けば、印が無い限りふだんの画面になる。
  }
  try {
    window.indexedDB?.deleteDatabase(DEMO_DB_NAME);
  } catch {
    // 消せなくても害はない(次にデモへ入った時に中身を入れ直す)。
  }
  window.location.replace("/");
}

/** デモでは呼ばせないサーバーの窓口。AI(Anthropic)で写真・文章を読む・場所を考える窓口は、呼ぶたびに
 * 本人の API 料金がかかる。デモは誰でも開けるので、ここだけは画面側で止める(押すと「デモでは使えません」)。 */
const DEMO_BLOCKED_API_PATHS = ["/api/extractReceipt", "/api/extractTripPlan", "/api/suggestPlaces", "/api/generateDraft"];

export const DEMO_BLOCKED_MESSAGE = "デモでは AI の読み取り・提案は使えません（実際のアプリでは使えます）。";

export function isDemoBlockedApi(url: string): boolean {
  let path = url;
  try {
    path = new URL(url, "http://localhost").pathname;
  } catch {
    // そのまま比べる。
  }
  return DEMO_BLOCKED_API_PATHS.some((blocked) => path === blocked || path.startsWith(`${blocked}?`));
}

/** デモの時だけ、上の窓口への fetch を、サーバーへ送らずに 403 で返す。 */
export function installDemoApiGuard(): void {
  if (!IS_DEMO || typeof window === "undefined" || typeof window.fetch !== "function") return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isDemoBlockedApi(url)) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: DEMO_BLOCKED_MESSAGE }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return originalFetch(input, init);
  };
}
