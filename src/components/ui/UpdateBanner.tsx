import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { applyUpdate, subscribeUpdateAvailable } from "../../lib/pwaUpdate";

const PROGRESS_DURATION_MS = 1500;

/** True while a Sheet (add/edit form) is open — Sheet.tsx is the only place that
 * locks body scroll, so this doubles as "don't reload mid-edit". */
function isFormOpen(): boolean {
  return document.body.style.overflow === "hidden";
}

export function UpdateBanner() {
  const [phase, setPhase] = useState<"idle" | "updating">("idle");
  const [filled, setFilled] = useState(false);
  /** フォームを開いているせいで切り替えを待っている間だけ true。 */
  const [waitingForForm, setWaitingForForm] = useState(false);

  // 更新が見つかった時点ですぐ帯を出す。以前は次のタップ/キー入力まで黙って
  // 待っていたので、画面を開いたまま眺めているだけの人には更新が来たことが
  // まったく伝わらなかった。触っているかどうかに関係なく知らせる。
  useEffect(() => subscribeUpdateAvailable(() => setPhase("updating")), []);

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

  if (phase === "idle") return null;

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
