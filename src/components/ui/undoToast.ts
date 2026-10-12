/**
 * 「元に戻す」付きのお知らせを出す入口(UI/UX 調査メモ 第4弾 A-2)。
 *
 * - showUndoToast … 変更はもう済ませてあり、「元に戻す」で逆の変更をする(完了・先送り・
 *   フォームの中の1行を消した時)。行を消すわけではないので、同期で困ることは無い
 *   (同じ行の更新が2回送られるだけ。後の方が勝つ)。
 * - deleteRowWithUndo / deleteWithUndo … 削除。押した時は一覧から隠すだけで、お知らせが閉じた時に
 *   本当に消す(理由は src/lib/deferredDelete.ts の先頭)。元に戻すは隠すのをやめるだけで、
 *   DB も同期も触らない。
 *
 * どちらも React の外から呼べる(ToastProvider が描く。src/components/ui/toastStore.ts)。
 */
import {
  deferDelete,
  type DeferredDelete,
  type DeferredDeleteTarget,
  type PendingDeleteRow,
} from "../../lib/deferredDelete";
import { UNDOABLE_DELETES, type UndoableDeleteKind } from "../../lib/undoableDeletes";
import { ACTION_TOAST_DURATION_MS, showToast } from "./toastStore";

export const UNDO_LABEL = "元に戻す";
export const UNDO_DURATION_MS = ACTION_TOAST_DURATION_MS;

/** お知らせの中で名前を「」で囲む。長い題名は縮める(お知らせは横幅が狭い)。
 * スマホでは右下の「＋」を避けて1行に9文字ほどしか入らず、14文字まで残すと2行に収まらずに
 * 「…を完了しました」の方が切れていた(何をしたのかが読めない)ので、8文字にしている。 */
export function quoted(title: string | undefined, max = 8): string {
  const text = (title ?? "").trim();
  if (!text) return "";
  return `「${text.length > max ? `${text.slice(0, max)}…` : text}」`;
}

/** もう済ませた変更に「元に戻す」を付ける。返り値はお知らせの番号(dismissToast 用)。 */
export function showUndoToast(message: string, undo: () => unknown): number {
  return showToast(message, {
    action: {
      label: UNDO_LABEL,
      onClick: async () => {
        await undo();
        showToast("元に戻しました");
      },
    },
  });
}

/**
 * 一覧のゴミ箱から1件消す時の入口。確認は聞かずに隠し、「削除しました・元に戻す」を出す。
 * 本当の削除(一緒に落とすもの込み)は src/lib/undoableDeletes.ts の種類ごとの削除。
 * alsoHide は、一緒に消える行(タスクのサブタスクなど)を同じ間だけ隠すため。
 */
export function deleteRowWithUndo(
  kind: UndoableDeleteKind,
  id: string,
  message = "削除しました",
  alsoHide: PendingDeleteRow[] = [],
): DeferredDelete {
  const { table, remove } = UNDOABLE_DELETES[kind];
  return deleteWithUndo([{ table, id }, ...alsoHide], () => remove(id), message, { kind, id });
}

/**
 * rows を一覧から隠して「削除しました・元に戻す」を出す。commit(本当の削除)は、
 * お知らせが時間切れ・次のお知らせに置き換わった・画面が隠れた時に1回だけ呼ぶ。
 * target を渡すと、待っている間にアプリが閉じられても次に開いた時に消し切る(deferredDelete の控え)。
 */
export function deleteWithUndo(
  rows: PendingDeleteRow[],
  commit: () => unknown,
  message = "削除しました",
  target?: DeferredDeleteTarget,
): DeferredDelete {
  const pending = deferDelete(rows, commit, target);
  showToast(message, {
    action: {
      label: UNDO_LABEL,
      onClick: () => {
        if (pending.undo()) showToast("元に戻しました");
      },
    },
    onClose: (reason) => {
      if (reason === "action") return;
      pending.commit().catch((error) => {
        console.error("[undo] failed to delete:", error);
        showToast("削除できませんでした", "error");
      });
    },
  });
  return pending;
}
