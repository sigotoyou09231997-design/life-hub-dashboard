import { useEffect, useRef, useState } from "react";

/**
 * 起動の待ち(ログインの確認 → 同期の準備)が終わらないまま、白い画面で止まった時の立て直し(2026-11-09)。
 *
 * 本人「アプリの画面を切り替えて、また戻ってきた時に、真っ白の画面から動かない」。
 * App.tsx は、セッションが分かって同期の準備(サーバーから約20の表を取り直す)が済むまで、白い待ち画面を出す。
 * この待ちには上限が無かった。iPhone はアプリを裏に回すと通信を止めるので、その瞬間に走っていた通信は、
 * 戻ってきても返ってこないことがある(ログインの確認が掴んだまま離さない鍵も同じ)。すると白いまま永久に待つ。
 * 新しい版が出ると「ほかのアプリへ移った瞬間に読み込み直す」(UpdateBanner.tsx)ので、裏に回る瞬間に
 * 起動が始まり、ちょうどこの形で止まりやすい。
 * index.html の「真っ白なら立て直す」台本は #root が空の時だけ働くが、この待ち画面は中身がある(背景の要素)ので働かなかった。
 *
 * 直し: 画面に出ている間の待ちが BOOT_STALL_MS 続いたら、1回だけ読み込み直す(本人が開き直すのと同じ)。
 * 読み込み直しても RETRY_GAP_MS 以内にまた止まったら、繰り返さずに「読み込み直す」ボタンを出す(白いままにしない)。
 * 数えるのは画面が見えていて、タイマーが動いている間だけ(裏に回っている間・止められている間は数えない)。
 */
export const BOOT_STALL_MS = 8_000;
export const RETRY_GAP_MS = 2 * 60_000;
export const BOOT_STALL_KEY = "lifehub:boot-stall-reloaded-at";
const TICK_MS = 500;

/** 前に自動で読み込み直した時刻から、今回も読み込み直すか、あきらめてボタンを出すか。 */
export function decideBootStall(lastReloadAt: number | null, now: number): "reload" | "giveup" {
  if (lastReloadAt !== null && Number.isFinite(lastReloadAt) && now - lastReloadAt >= 0 && now - lastReloadAt < RETRY_GAP_MS) {
    return "giveup";
  }
  return "reload";
}

function readLastReload(): number | null {
  try {
    const raw = window.sessionStorage.getItem(BOOT_STALL_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function markReload(now: number): void {
  try {
    window.sessionStorage.setItem(BOOT_STALL_KEY, String(now));
  } catch {
    // 書けなくても読み込み直しはする(繰り返しを止められないので、その時はあきらめる側に倒す)
  }
}

/**
 * waiting が true(白い待ち画面を出している)の間、見えている時間を数える。BOOT_STALL_MS を超えたら
 * 1回だけ読み込み直す。もう読み込み直したばかりなら true を返す(呼ぶ側が「読み込み直す」ボタンを出す)。
 */
export function useBootStallWatch(waiting: boolean, reload: () => void = () => window.location.reload()): boolean {
  const [gaveUp, setGaveUp] = useState(false);
  // 呼ぶ側が描き直すたびに数え直さないよう、読み込み直しの関数は ref で持つ(待ちの間に何度描き直されても数え続ける)。
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!waiting) return;
    let visibleMs = 0;
    let last = Date.now();
    let done = false;
    const timer = window.setInterval(() => {
      const now = Date.now();
      // 裏に回って止められていた間は、戻った最初の1回で大きく進む。その分は数えない(1回ぶんまで)。
      const delta = Math.min(now - last, TICK_MS * 2);
      last = now;
      if (done || document.visibilityState !== "visible") return;
      visibleMs += delta;
      if (visibleMs < BOOT_STALL_MS) return;
      done = true;
      window.clearInterval(timer);
      if (decideBootStall(readLastReload(), now) === "reload") {
        markReload(now);
        reloadRef.current();
      } else {
        setGaveUp(true);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [waiting]);
  return waiting && gaveUp;
}
