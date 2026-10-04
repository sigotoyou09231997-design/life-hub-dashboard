import type { TabOption } from "../ui/Tabs";

/** 「予定を追加」の画面の上に出す切り替え。手で入力するか、案内の文章・写真から
 * まとめて読み取るか。
 *
 * 文章・写真から入れる入口は「＋ → 写真・文章」と旅行の日程タブの下のボタンにあったが、
 * 「この日に予定を追加」や今日の画面の「予定を追加」から入ると、そこには無く、
 * 1件ずつ打つしかなかった(2026-10-04の指摘)。どこから「予定を追加」を開いても同じ切り替えが
 * 出るよう、追加の画面そのものに置く。 */
export type AddMethod = "form" | "scan";

export const ADD_METHOD_OPTIONS: TabOption<AddMethod>[] = [
  { value: "form", label: "入力して追加" },
  { value: "scan", label: "文章・写真から" },
];
