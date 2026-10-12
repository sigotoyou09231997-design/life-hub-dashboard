import { useMemo, useSyncExternalStore } from "react";
import { getPendingDeletes, subscribePendingDeletes, withoutPendingDeletes } from "../lib/deferredDelete";

/**
 * 「削除しました・元に戻す」で、まだ本当には消していない行の集合(src/lib/deferredDelete.ts)。
 * UI/UX 調査メモ 第4弾 A-2。
 */
export function usePendingDeletes(): ReadonlySet<string> {
  return useSyncExternalStore(subscribePendingDeletes, getPendingDeletes, getPendingDeletes);
}

/**
 * まだ本当には消していない行を除いた一覧。一覧の部品ではなく、データを読んでいる画面(ページ)の
 * 側で使う — 同じデータから作る合計・件数・カレンダーの印も、一緒に消えて見えるように。
 *
 *   const notes = useWithoutPendingDeletes("notes", useLiveQuery(() => db.notes.toArray(), []));
 *
 * 何も隠していない時は渡した配列をそのまま返す。隠している間も、行か集合が変わらない限り
 * 同じ配列を返す(依存配列に入れても、描くたびに作り直さない)。
 */
export function useWithoutPendingDeletes<T extends { id?: string }>(table: string, rows: T[]): T[];
export function useWithoutPendingDeletes<T extends { id?: string }>(table: string, rows: T[] | undefined): T[] | undefined;
export function useWithoutPendingDeletes<T extends { id?: string }>(table: string, rows: T[] | undefined): T[] | undefined {
  const pending = usePendingDeletes();
  return useMemo(() => rows && withoutPendingDeletes(table, rows, pending), [table, rows, pending]);
}
