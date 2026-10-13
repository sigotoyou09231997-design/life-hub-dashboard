/**
 * 修正依頼の「いま、どうなっているか」を、アプリを開いている間、画面に出し続けるための読み出し係
 * (2026-10-13、本人「修正中の間、アプリでは本当に直してるか分からないから、修正中ですを出したい」)。
 *
 * 状態は new(対応待ち) → working(対応中、035) → done(対応済み)。直し始めた時に Mac から印を付ける
 * (scripts/feedback-inbox.mjs --working)。送った人には自分の依頼、持ち主にはすべての依頼が返る(RLS)。
 *
 * 画面のあちこち(「修正」ボタン・状況の一覧・持ち主の「修正中」の札)が同じ読み出しを使うので、ここに1つだけ持つ。
 * 見ている画面が1つも無ければ止まる。まだ終わっていない依頼がある間だけ、30秒ごとに読み直す
 * (何も送っていない人は、開いた時に1回読むだけ)。
 */
import { loadRecentFeedback, subscribeFeedbackChanged, type FeedbackItem } from "./appFeedback";

/** 一度に読む件数。 */
const FEEDBACK_READ_LIMIT = 50;

/** 終わっていない依頼がある間の、読み直しの間隔。 */
export const FEEDBACK_POLL_MS = 30_000;

let snapshot: readonly FeedbackItem[] = [];
let signature = "";
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let stopChangeSubscription: (() => void) | undefined;
let generation = 0;

export function getFeedbackProgressSnapshot(): readonly FeedbackItem[] {
  return snapshot;
}

/** まだ終わっていない依頼(対応待ち・対応中・保留中)。 */
export function isActiveFeedback(item: FeedbackItem): boolean {
  return item.status === "new" || item.status === "working" || item.status === "hold";
}

export interface FeedbackCounts {
  /** 対応待ち(まだ手を付けていない)。 */
  waiting: number;
  /** 対応中。 */
  working: number;
  /** 保留中。 */
  hold: number;
}

/** 状態ごとの件数(2026-10-14、本人「対応待ち何件という表示も欲しい」)。送った人には自分の依頼の分、持ち主には全部の分。 */
export function countFeedback(items: readonly FeedbackItem[]): FeedbackCounts {
  return {
    waiting: items.filter((item) => item.status === "new").length,
    working: items.filter((item) => item.status === "working").length,
    hold: items.filter((item) => item.status === "hold").length,
  };
}

function sign(items: readonly FeedbackItem[]): string {
  return items.map((item) => `${item.id}:${item.status}:${item.workingAt ?? ""}:${item.statusNote ?? ""}:${item.estimateMinutes ?? ""}`).join("|");
}

async function refresh(): Promise<void> {
  const mine = generation;
  clearTimeout(timer);
  // 件数を数えるので、画面に出す数(5件)より多めに読む(10件で切ると、11件目以降が「対応待ち」に数えられない)。
  const items = await loadRecentFeedback(FEEDBACK_READ_LIMIT);
  if (mine !== generation) return; // 読んでいる間に、見ている画面が無くなった(または作り直された)
  const next = sign(items);
  if (next !== signature) {
    signature = next;
    snapshot = items;
    for (const listener of listeners) listener();
  }
  // 終わっていない依頼がある間だけ、読み直し続ける。見えていない間(裏のタブ)は、戻った時に読む。
  if (items.some(isActiveFeedback) && document.visibilityState === "visible") {
    timer = setTimeout(() => void refresh(), FEEDBACK_POLL_MS);
  }
}

function onVisible(): void {
  if (document.visibilityState === "visible") void refresh();
}

function start(): void {
  generation += 1;
  document.addEventListener("visibilitychange", onVisible);
  stopChangeSubscription = subscribeFeedbackChanged(() => void refresh());
  void refresh();
}

function stop(): void {
  generation += 1;
  clearTimeout(timer);
  document.removeEventListener("visibilitychange", onVisible);
  stopChangeSubscription?.();
  stopChangeSubscription = undefined;
}

/** 状況を見る画面の登録(React の useSyncExternalStore 用)。最初の1つが登録された時に読み始め、最後の1つが外れたら止める。 */
export function subscribeFeedbackProgress(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** テスト用: 控えを空に戻す。 */
export function resetFeedbackProgressForTests(): void {
  stop();
  listeners.clear();
  snapshot = [];
  signature = "";
}
