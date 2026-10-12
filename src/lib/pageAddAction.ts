import { useSyncExternalStore } from "react";

/**
 * いま開いている画面の「追加」(右下の「＋」= src/components/ui/PageFab.tsx が出しているもの)。
 *
 * PC では右下の「＋」を出さず、上の帯の「＋追加」に一本化した(2026-10-12、UI/UX 調査メモ 第2弾 P-2)。
 * 帯のボタンは、画面に「＋」があればその働き(旅行なら「旅行を追加」、Gmail なら「新規メール」)を、
 * 無ければ「何を追加しますか?」を開く。そのために、「＋」が出ている間だけここへ名前と働きを置く。
 */
export interface PageAddAction {
  label: string;
  run: () => void;
}

let current: PageAddAction | null = null;
const listeners = new Set<() => void>();

export function setPageAddAction(action: PageAddAction | null) {
  current = action;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageAddAction(): PageAddAction | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
