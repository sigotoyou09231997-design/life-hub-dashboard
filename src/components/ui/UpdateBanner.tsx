import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { applyUpdate, subscribeUpdateAvailable, wasUpdatedRecently } from "../../lib/pwaUpdate";

const PROGRESS_DURATION_MS = 1500;

/**
 * 2026-10-12、本人「アップデートの通知が何回も来るから一回にまとめて欲しい」。
 * 前は新しい版が見つかるたびに（60秒ごとに見に行く）帯を出してその場で読み込み直して
 * いたので、1晩に十数回出すと、使っている最中に十数回切り替わっていた。
 *
 * いまは「いつ見つかったか」で分ける:
 *  - 開いてすぐ（LAUNCH_WINDOW_MS 以内）… まだ何も触っていないので、前と同じくその場で帯を出して切り替える
 *  - 使っている途中 … 帯も出さず切り替えもしない。ほかのアプリ・タブへ移った（画面が隠れた）時に
 *    黙って1回だけ切り替える。待っている間に何回出ても、切り替えるのは最後の版への1回だけ
 *    （待っている版は新しいものに置き換わっていくため）
 *  - 開きっぱなしで MAX_HOLD_MS たった … 1回だけ帯を出して切り替える（いつまでも古い版のままにしない）
 * どの場合も、入力のシートを開いている間は切り替えない（書きかけを捨てないため）。
 */
const LAUNCH_WINDOW_MS = 15_000;
const MAX_HOLD_MS = 3 * 60 * 60_000;
/** 更新を適用して読み込み直した直後に、もう次の版が見つかった時は、帯を出さずに待つ(画面を離れた時に黙って切り替える)。
 * 2026-10-13、本人「アップデートが来ていますの通知が二回来た」— 続けて出すと、戻るたびに帯が出て読み込み直し、その直後にまた次の版が
 * 見つかって帯がもう1回出ていた(帯→読み込み直し→帯)。 */
const RECENT_UPDATE_MS = 2 * 60_000;

/** この画面（タブ）を読み込んだ、またはほかのアプリ・タブから戻ってきた時刻。「開いてすぐ」かどうかの基準。
 * 2026-10-12: 読み込んだ時刻だけを見ていたので、アプリを開いたまま行き来する使い方(iPhone のホーム画面アプリ)では
 * 戻ってきて新しい版が見つかっても「使っている途中」と数えられ、反映が遅れた(本人の「反映されてない」)。
 * 戻ってきた直後(戻ると同時に更新を確かめに行く)も、開いてすぐと同じに扱う。 */
let loadedAt = Date.now();
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadedAt = Date.now();
  });
}

/** True while a Sheet (add/edit form) is open — Sheet.tsx is the only place that
 * locks body scroll, so this doubles as "don't reload mid-edit". */
function isFormOpen(): boolean {
  return document.body.style.overflow === "hidden";
}

export function UpdateBanner() {
  /** idle=更新なし / held=使っている途中に見つかったので、画面を離れるまで待っている / updating=帯を出して切り替え中 */
  const [phase, setPhase] = useState<"idle" | "held" | "updating">("idle");
  const [filled, setFilled] = useState(false);
  /** フォームを開いているせいで切り替えを待っている間だけ true。 */
  const [waitingForForm, setWaitingForForm] = useState(false);

  // 開いてすぐなら、その場で帯を出して切り替える。使っている途中なら待つ（上の説明）。
  useEffect(
    () =>
      subscribeUpdateAvailable(() => {
        const justOpened = Date.now() - loadedAt <= LAUNCH_WINDOW_MS && !wasUpdatedRecently(RECENT_UPDATE_MS);
        setPhase(justOpened ? "updating" : "held");
      }),
    [],
  );

  // 待っている間: 画面が隠れたら黙って切り替える。開きっぱなしで3時間たったら帯を出す。
  useEffect(() => {
    if (phase !== "held") return;
    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if (isFormOpen()) return; // 書きかけのまま離れた時は、次に離れる時まで待つ
      void applyUpdate();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    // 裏に回したタブ（PC）で見つかった時は、もう誰も見ていないので今すぐ切り替えてよい。
    handleVisibility();
    const fallback = window.setTimeout(() => setPhase("updating"), MAX_HOLD_MS);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(fallback);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "updating") return;
    const raf = requestAnimationFrame(() => setFilled(true));
    let cancelled = false;
    let timeoutId: number;
    const startedAt = Date.now();
    // フォームを開いている間は切り替えを待つ。待ちっぱなしにはできない
    // (閉じないフォームやoverflowフラグの取り残しがあると帯が永遠に残る)ので
    // 上限は要るが、短すぎると入力の途中でリロードして書きかけを捨ててしまう。
    // 帯を触られていなくても出すようになった分ここに居合わせる確率が上がったため、
    // 15秒から5分に伸ばしてある。
    const MAX_DEFER_MS = 5 * 60_000;

    // Re-checked at fire time (and re-armed if needed) so a form opened *during*
    // the animation still gets to finish before the reload happens.
    function scheduleApply(delay: number) {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        if (isFormOpen() && Date.now() - startedAt < MAX_DEFER_MS) {
          setWaitingForForm(true);
          scheduleApply(1000);
          return;
        }
        setWaitingForForm(false);
        void applyUpdate();
      }, delay);
    }
    scheduleApply(PROGRESS_DURATION_MS + 150);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timeoutId);
    };
  }, [phase]);

  if (phase !== "updating") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[80] animate-slide-down motion-reduce:animate-none"
    >
      <div className="bg-slate-900 pt-[env(safe-area-inset-top)] text-white shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <Download size={18} className="shrink-0 text-white/80" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">アップデートが来ています</p>
            <p className="mt-0.5 text-xs text-white/60">
              {waitingForForm ? "入力が終わったら切り替えます" : "最新版に更新しています…"}
            </p>
          </div>
        </div>
        <div className="h-1 w-full bg-white/15">
          <div
            className="h-full bg-accent transition-[width] ease-linear motion-reduce:transition-none"
            style={{ width: filled ? "100%" : "0%", transitionDuration: `${PROGRESS_DURATION_MS}ms` }}
          />
        </div>
      </div>
    </div>
  );
}
