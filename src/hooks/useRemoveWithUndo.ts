import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { dismissToast } from "../components/ui/toastStore";
import { showUndoToast } from "../components/ui/undoToast";

/**
 * フォームの中の1行(買い物リストの品・チェックリストの項目)を消して、5秒間「元に戻す」を出す。
 * UI/UX 調査メモ 第4弾 A-2。
 *
 * 行はフォームの state の中だけにあり、「保存する」まで DB には書かない。なので元に戻すは
 * 消した行を元の位置に差し戻すだけで、同期のことは考えなくてよい。
 * フォームを閉じたら(保存・キャンセル)、もう差し戻す先が無いので、お知らせも一緒に消す。
 */
export function useRemoveWithUndo<T extends { id: string }>(setItems: Dispatch<SetStateAction<T[]>>) {
  const toastIdRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastIdRef.current !== null) dismissToast(toastIdRef.current);
    },
    [],
  );

  return useCallback(
    (items: T[], id: string, message: string) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return;
      const removed = items[index];
      setItems((current) => current.filter((item) => item.id !== id));
      toastIdRef.current = showUndoToast(message, () => {
        setItems((current) => {
          if (current.some((item) => item.id === removed.id)) return current;
          const at = Math.min(index, current.length);
          return [...current.slice(0, at), removed, ...current.slice(at)];
        });
      });
    },
    [setItems],
  );
}
