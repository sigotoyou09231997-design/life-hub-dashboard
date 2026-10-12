/**
 * お知らせ(トースト)の中身を、React の外に1つだけ持つ置き場。描くのは ToastProvider。
 *
 * UI/UX 調査メモ 第4弾 A-2「元に戻す」付きのお知らせのために、ToastProvider の state から
 * ここへ出した。
 * - 完了・先送りの「元に戻す」は、タスクの完了(toggleTaskCompletion)のような画面の外の関数から
 *   出したい。ホーム・今日・カレンダー・一覧(とスワイプ)が同じ関数を呼ぶので、関数の中で出せば
 *   どこから押しても同じように戻せる。
 * - 出ているのは常に1つだけ。新しいお知らせは古いものを置き換える。置き換えられた側にも
 *   onClose("replaced") を必ず1回呼ぶ — 「削除しました・元に戻す」の削除は、閉じた時に
 *   初めて本当に消す(src/lib/deferredDelete.ts)ので、黙って捨てると消えないまま残ってしまう。
 */

export type ToastTone = "success" | "error";

export interface ToastAction {
  /** ボタンの文字。例:「元に戻す」 */
  label: string;
  onClick: () => unknown;
}

/** お知らせが消えた理由。onClose に渡る。 */
export type ToastCloseReason =
  /** 時間切れ */
  | "timeout"
  /** 次のお知らせに置き換わった */
  | "replaced"
  /** ボタン(元に戻す)が押された */
  | "action"
  /** 出した側が消した(dismissToast) */
  | "dismissed"
  /** 画面が隠れた・お知らせの置き場が無くなった(flushToast) */
  | "flushed";

export interface ToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
  /** 出しておく時間(ミリ秒)。既定は文だけなら2.5秒、ボタン付きなら5秒。 */
  duration?: number;
  /** 消えた時に1回だけ呼ぶ。どの消え方でも必ず呼ぶ(置き換え・画面が隠れた時も)。 */
  onClose?: (reason: ToastCloseReason) => void;
}

/** 画面に描く分だけの中身。useSyncExternalStore に渡すので、変わる時は必ず作り直す。 */
export interface ToastView {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  /** 残り時間の線を、この長さで縮める。 */
  duration: number;
  /** 指が乗っている・ボタンに焦点がある間は止める(時間切れまで読めないと押せないため)。 */
  paused: boolean;
}

export const TOAST_DURATION_MS = 2500;
export const ACTION_TOAST_DURATION_MS = 5000;

interface LiveToast {
  view: ToastView;
  action?: ToastAction;
  onClose?: (reason: ToastCloseReason) => void;
  timer?: ReturnType<typeof setTimeout>;
  /** 時間切れになる時刻(止めている間は使わない)。 */
  deadline: number;
  /** 止めた時点の残り時間。 */
  remaining: number;
}

let live: LiveToast | null = null;
let lastId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function startTimer(entry: LiveToast, ms: number): void {
  entry.deadline = Date.now() + ms;
  entry.timer = setTimeout(() => close(entry.view.id, "timeout"), ms);
}

function close(id: number, reason: ToastCloseReason): boolean {
  if (!live || live.view.id !== id) return false;
  const entry = live;
  clearTimeout(entry.timer);
  live = null;
  emit();
  try {
    entry.onClose?.(reason);
  } catch (error) {
    console.error("[toast] onClose failed:", error);
  }
  return true;
}

/**
 * お知らせを出す。返り値はこのお知らせの番号(dismissToast で消す時に使う)。
 *
 *   showToast("保存しました")                  // 今までどおり
 *   showToast("保存に失敗しました", "error")     // 今までどおり
 *   showToast("削除しました", { action: { label: "元に戻す", onClick }, onClose })
 *
 * 「元に戻す」を付けるなら、たいていは src/components/ui/undoToast.ts の
 * showUndoToast / deleteWithUndo を使う方が短い。
 */
export function showToast(message: string, toneOrOptions?: ToastTone | ToastOptions): number {
  const options: ToastOptions = typeof toneOrOptions === "string" ? { tone: toneOrOptions } : (toneOrOptions ?? {});
  // 前のお知らせの onClose が、さらにお知らせを出すこともある(削除に失敗した時など)。
  // 残っている限り閉じ続けて、どれの onClose も取りこぼさない。
  while (live) close(live.view.id, "replaced");

  lastId += 1;
  const duration = options.duration ?? (options.action ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS);
  const entry: LiveToast = {
    view: {
      id: lastId,
      message,
      tone: options.tone ?? "success",
      actionLabel: options.action?.label,
      duration,
      paused: false,
    },
    action: options.action,
    onClose: options.onClose,
    deadline: 0,
    remaining: duration,
  };
  live = entry;
  startTimer(entry, duration);
  emit();
  return entry.view.id;
}

/** 出ているお知らせを消す。id を渡した時は、それがまだ出ている時だけ消す。 */
export function dismissToast(id?: number): boolean {
  if (!live) return false;
  return close(id ?? live.view.id, "dismissed");
}

/** 画面が隠れた時など、出ているお知らせをすぐ閉じる(待っていた削除はここで本当に消す)。 */
export function flushToast(): void {
  if (live) close(live.view.id, "flushed");
}

/** お知らせのボタンが押された。先に閉じてから押した時の働きを呼ぶ — 働きの中で
 * 「元に戻しました」を出しても、それを閉じてしまわないように。 */
export function runToastAction(id: number): void {
  if (!live || live.view.id !== id || !live.action) return;
  const action = live.action;
  close(id, "action");
  try {
    void Promise.resolve(action.onClick()).catch((error) => {
      console.error("[toast] action failed:", error);
      showToast("元に戻せませんでした", "error");
    });
  } catch (error) {
    console.error("[toast] action failed:", error);
    showToast("元に戻せませんでした", "error");
  }
}

/** 指が乗った・ボタンに焦点が来た。時間切れを止める。 */
export function pauseToast(id: number): void {
  if (!live || live.view.id !== id || live.view.paused) return;
  clearTimeout(live.timer);
  live.remaining = Math.max(0, live.deadline - Date.now());
  live.view = { ...live.view, paused: true };
  emit();
}

/** 指が離れた・焦点が外れた。止めた所から時間を進める。 */
export function resumeToast(id: number): void {
  if (!live || live.view.id !== id || !live.view.paused) return;
  live.view = { ...live.view, paused: false };
  startTimer(live, live.remaining);
  emit();
}

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToastSnapshot(): ToastView | null {
  return live?.view ?? null;
}
