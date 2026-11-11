/**
 * メモの本文を、1行ずつのタスクの候補にわける(第73弾)。
 * 参考: Claude Meetings / Whiteboards が、話し合いの内容を「やること」の一覧に整理するところ。
 * LIFE HUB のメモは、「・見積もりを出す」「・資料を送る」のように箇条書きで書く人が多いのに、
 * 「タスク化」を押すと題名の1件しか作れず、1行ずつ打ち直す必要があった。
 *
 * 読み取りは文字の形だけ(AI は使わない): 行頭の印(・ - * ● ○ □ ☐ ✓ 数字.)を外し、空行を除く。
 * 2行以上あるときだけ候補を返す(1行なら今までどおり題名の1件)。
 */
const BULLET = /^\s*(?:[-*•・●○◦▪■□☐☑✓✔]|\d{1,2}[.)．、]|[（(]\d{1,2}[)）])\s*/;

export const MAX_MEMO_TASKS = 20;

export function splitMemoTasks(body: string | undefined): string[] {
  if (!body) return [];
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(BULLET, "").trim())
    .filter((line) => line.length > 0);
  // 同じ行は1件にまとめる。
  const unique = lines.filter((line, index) => lines.indexOf(line) === index);
  if (unique.length < 2) return [];
  return unique.slice(0, MAX_MEMO_TASKS).map((line) => (line.length > 80 ? line.slice(0, 80) : line));
}
