import { scopedKey } from "./accounts";
import type { HideableFeature } from "./hiddenFeatures";

/**
 * ホームの「LIFE HUB をそろえる」(始め方のチェックリスト)。UI/UX 調査メモ 第5弾 A-4(2026-10-13)。
 *
 * 記録がほとんど無い人のホームは「¥0」「0件」「〜はありません」ばかり。最初にやっておくと便利なことを、短いリストにして
 * 進み具合を輪で見せる。済んだかどうかは、実際のデータから決める(チェックを手で付けない)。
 * 全部済んだら、二度と出さない。「今は表示しない」を押したら、14日間だけ出さない。
 * ここは文言と判定だけの純粋な部分。データを読んで描くのは src/components/home/SetupChecklist.tsx。
 */

export interface SetupFacts {
  /** 給与が1件以上ある。 */
  salary: boolean;
  /** 支出が1件以上ある。 */
  expense: boolean;
  /** 予定が1件以上ある。 */
  event: boolean;
  /** 自宅の住所を入れてある(この端末の設定)。 */
  homeAddress: boolean;
  /** Google カレンダーとの同期を入にしてある。 */
  googleCalendar: boolean;
}

export type SetupItemId = "salary" | "expense" | "event" | "homeAddress" | "googleCalendar";

export interface SetupItem {
  id: SetupItemId;
  label: string;
  /** 何の役に立つか、一言。 */
  hint: string;
  done: boolean;
  /** 押した時に移る画面(無ければ action)。 */
  to?: string;
  /** 押した時に、その場で開く入力(画面を移らない)。 */
  action?: "expense" | "event";
}

export function buildSetupItems(facts: SetupFacts): SetupItem[] {
  return [
    {
      id: "salary",
      label: "給与を登録する",
      hint: "給料日まで1日いくら使えるかが出ます",
      done: facts.salary,
      to: "/records/expense?new=salary",
    },
    {
      id: "expense",
      label: "最初の支出を記録する",
      hint: "検索欄に「ランチ 1200」と打っても入れられます",
      done: facts.expense,
      action: "expense",
    },
    {
      id: "event",
      label: "最初の予定を入れる",
      hint: "「明日19時 歯医者」のように、文章でも入れられます",
      done: facts.event,
      action: "event",
    },
    {
      id: "homeAddress",
      label: "自宅の住所を入れる",
      hint: "旅行の地図で、出発・到着の場所になります",
      done: facts.homeAddress,
      to: "/settings",
    },
    {
      id: "googleCalendar",
      label: "Google カレンダーと同期する",
      hint: "Google の予定がここにも出て、ここで足した予定が Google にも入ります",
      done: facts.googleCalendar,
      to: "/settings",
    },
  ];
}

export interface SetupProgress {
  items: SetupItem[];
  doneCount: number;
  total: number;
  /** 全部済んだ。 */
  complete: boolean;
  /** 進み具合(0〜1)。輪の長さに使う。 */
  ratio: number;
}

/** 項目が、どの機能に属すか。設定の「使う機能」で隠した機能の項目は出さない(src/lib/hiddenFeatures.ts)。 */
const ITEM_FEATURE: Record<SetupItemId, HideableFeature> = {
  salary: "money",
  expense: "money",
  event: "schedule",
  googleCalendar: "schedule",
  homeAddress: "trips",
};

export function computeSetupProgress(facts: SetupFacts, hiddenFeatures: readonly HideableFeature[] = []): SetupProgress {
  const items = buildSetupItems(facts).filter((item) => !hiddenFeatures.includes(ITEM_FEATURE[item.id]));
  const doneCount = items.filter((item) => item.done).length;
  // 項目が1つも残らなければ、「全部済んだ」扱いにして出さない(0 で割らない)。
  if (items.length === 0) return { items, doneCount: 0, total: 0, complete: true, ratio: 1 };
  return { items, doneCount, total: items.length, complete: doneCount === items.length, ratio: doneCount / items.length };
}

/** 「今は表示しない」で出さない日数。 */
export const SETUP_HIDE_DAYS = 14;

const HIDDEN_UNTIL_KEY = "lifeHubSetupChecklistHiddenUntil";
const DONE_KEY = "lifeHubSetupChecklistDone";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function safeGet(storage: ReadableStorage, key: string): string | null {
  try {
    return storage.getItem(scopedKey(key));
  } catch {
    return null;
  }
}

function safeSet(storage: WritableStorage, key: string, value: string): void {
  try {
    storage.setItem(scopedKey(key), value);
  } catch {
    // 書けない環境(プライベートモードなど)では、表示を抑えられないだけ。
  }
}

/** いま出さない状態か。全部済んだことがある、または「今は表示しない」の期間中。 */
export function isSetupChecklistSuppressed(now: number, storage: ReadableStorage = window.localStorage): boolean {
  if (safeGet(storage, DONE_KEY) === "1") return true;
  const until = Number(safeGet(storage, HIDDEN_UNTIL_KEY));
  return Number.isFinite(until) && until > now;
}

export function hideSetupChecklist(now: number, storage: WritableStorage = window.localStorage): void {
  safeSet(storage, HIDDEN_UNTIL_KEY, String(now + SETUP_HIDE_DAYS * 86_400_000));
}

/** 全部済んだ印。あとで給与や支出を消しても、もう出さない。 */
export function markSetupChecklistDone(storage: WritableStorage = window.localStorage): void {
  safeSet(storage, DONE_KEY, "1");
}
