import { useEffect, useRef, useState } from "react";
import type { Task } from "../../types";
import { formatCompactDate, isDueTodayOrEarlier, isOverdue } from "../../lib/date";
import { getScheduleCategory } from "../../lib/scheduleCategories";
import { isRepeating, repeatLabel } from "../../lib/repeatRule";
import { haptic } from "../../lib/haptics";
import { prefersReducedMotion } from "../../lib/reducedMotion";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { SwipeRow, type SwipeAction } from "../ui/SwipeRow";
import { CalendarArrowDown, Check, Plus, Trash2 } from "lucide-react";

interface Props {
  task: Task;
  allTasks: Task[];
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onAddSubtask: (parentId: string) => void;
  /** 期日を明日へずらす。渡さなければ「明日へ」は出ない。 */
  onPostpone?: (task: Task) => void;
  indent?: boolean;
  /**
   * 完了にした時に、行をたたんでから完了を書き込む(UI/UX 調査メモ 第4弾 A-4)。
   * 完了にすると一覧から抜ける所(予定・タスクの「今日」・一覧の未完了 → 完了済みの組)で付ける。
   * 完了してもその場に残る所(カレンダーの日ごと・サブタスク)では付けない — たたんだ行がまた開くと、
   * 消えたのか残ったのか分からなくなるため。
   */
  collapseOnComplete?: boolean;
}

const PRIORITY_TONE = { high: "danger", medium: "warning", low: "neutral" } as const;
const PRIORITY_LABEL = { high: "高", medium: "中", low: "低" } as const;

/**
 * 完了の演出(UI/UX 調査メモ 第4弾 A-4)の時間。チェックが跳ねる(check-pop 220ms)のと同時に
 * 取り消し線を左から引き(gestures.css の task-strike-draw、120ms 遅れで 280ms)、
 * 引き終わったら行をたたむ(task-row-collapse)。たたみ終わってから完了を書き込む —
 * 先に書き込むと、行はその瞬間に一覧から抜けて(完了済みの組へ移る・今日の一覧から消える)、
 * 演出を見せる前に消えてしまう。
 */
const STRIKE_DONE_MS = 420;
const COLLAPSE_MS = 260;
/** 書き込んだのに完了が届かない(書き込みに失敗した等)時に、行を元へ戻すまでの時間。 */
const COMPLETION_FALLBACK_MS = 2000;

export function TaskItem({ task, allTasks, onToggle, onEdit, onDelete, onAddSubtask, onPostpone, indent, collapseOnComplete }: Props) {
  // 完了の演出の段階。strike = チェックと取り消し線、collapse = 行をたたんでいる。
  const [completion, setCompletion] = useState<"strike" | "collapse" | null>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  /** 演出が終わったら書き込む、の待ちがあるか(途中で画面ごと消えた時に、待たずに書き込むため)。 */
  const pendingWriteRef = useRef(false);
  // 待ちのあとに呼ぶので、最新の task と onToggle を読む。
  const latestRef = useRef({ task, onToggle });
  latestRef.current = { task, onToggle };
  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const overdue = !task.completed && isOverdue(task.dueDate, task.dueTime);
  const category = getScheduleCategory(task.category);
  // 「明日へ」は、まだ終わっていない今日ぶん・期限切れのタスクにだけ出す。
  // 先の日付のタスクに出しても押す理由が無く、行のボタンが増えるだけになる。
  const canPostpone = Boolean(onPostpone) && !task.completed && isDueTodayOrEarlier(task.dueDate);

  // 書き込んだ完了が届いたら、演出の印を外す(届く前に外すと、行が一瞬だけ未完了の姿に戻る)。
  useEffect(() => {
    if (task.completed) setCompletion(null);
  }, [task.completed]);

  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      // 演出の途中で画面ごと消えた(タブを切り替えた等)時も、完了にしたことは落とさない。
      if (pendingWriteRef.current) latestRef.current.onToggle(latestRef.current.task);
    },
    [],
  );

  function later(fn: () => void, ms: number) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  function writeCompletion() {
    pendingWriteRef.current = false;
    latestRef.current.onToggle(latestRef.current.task);
    later(() => setCompletion(null), COMPLETION_FALLBACK_MS);
  }

  /** チェックの丸を押した・右へ払った。完了にする時だけ演出を挟む(戻す時はすぐ)。 */
  function handleToggle() {
    if (completion) return;
    if (task.completed) {
      onToggle(task);
      return;
    }
    haptic("success");
    // 動きを減らす設定の時は、演出を飛ばしてすぐ完了にする。
    if (prefersReducedMotion()) {
      onToggle(task);
      return;
    }
    setCompletion("strike");
    pendingWriteRef.current = true;
    if (!collapseOnComplete) {
      later(writeCompletion, STRIKE_DONE_MS);
      return;
    }
    later(() => {
      // たたむ直前の高さを測って、そこから 0 へ動かす(auto からは動かせないため)。
      const el = outerRef.current;
      if (el) el.style.setProperty("--task-row-h", `${el.offsetHeight}px`);
      setCompletion("collapse");
    }, STRIKE_DONE_MS);
    later(writeCompletion, STRIKE_DONE_MS + COLLAPSE_MS);
  }

  // 見た目の上では、演出を始めた時点で完了にする(書き込みは演出のあと)。
  const shownDone = task.completed || completion !== null;

  // スワイプ(UI/UX 調査メモ 第4弾 A-3)。右へ払うと完了、左へ払うと明日へ。行のボタンはそのまま残す
  // (パソコン・読み上げ・払うのが苦手な人の通り道)。終わったタスクは払えない(戻すのはチェックの丸で)。
  const swipeRight: SwipeAction | undefined =
    !task.completed && !completion
      ? { label: "完了", icon: Check, tone: "complete", after: "return", onCommit: handleToggle }
      : undefined;
  const swipeLeft: SwipeAction | undefined =
    canPostpone && !completion
      ? { label: "明日へ", icon: CalendarArrowDown, tone: "later", after: "leave", onCommit: () => onPostpone!(task) }
      : undefined;

  // 確認は聞かない。消したあと5秒間「元に戻す」が出て、サブタスクごと戻せる
  // (UI/UX 調査メモ 第4弾 A-2。お知らせは TaskList.tsx の deleteTaskWithUndo が出す)。
  function handleDeleteClick() {
    if (task.id) onDelete(task.id);
  }

  return (
    <div ref={outerRef} className={`${indent ? "ml-8" : ""} ${completion === "collapse" ? "task-row--collapsing" : ""}`}>
      <SwipeRow left={swipeLeft} right={swipeRight}>
      <ListRow className={`task-completion flex items-start gap-3 transition-opacity duration-200 ${task.completed ? "task-completion--done opacity-60" : "opacity-100"}`}>
        <button
          onClick={handleToggle}
          aria-label="完了切り替え"
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            shownDone ? "border-success bg-success text-white" : "border-slate-300"
          }`}
        >
          {shownDone && <Check size={12} strokeWidth={3} className="animate-check-pop motion-reduce:animate-none" />}
        </button>

        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`タスク「${task.title}」を編集`}
          className="block min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <p
            title={task.title}
            className={`line-clamp-2 text-sm font-medium ${
              task.completed ? "text-slate-400 line-through" : completion ? "text-slate-400" : "text-slate-900"
            }`}
          >
            {/* 完了にした瞬間だけ、取り消し線を左から引く(2行に折り返していても1行目→2行目と続けて引く。gestures.css)。
                書き込みが済んだら、ふつうの line-through に入れ替わる。 */}
            <span className={completion ? "task-strike is-striking" : "task-strike"}>{task.title}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={PRIORITY_TONE[task.priority]}>優先度 {PRIORITY_LABEL[task.priority]}</Badge>
            {task.dueDate && (
              // 期限は "2026-08-21 10:00" のようなISO表記だと、これだけでバッジ列が
              // 折り返して1件あたり1行増えていた。今日/明日など読んで分かる短い形にする。
              <Badge tone={overdue ? "danger" : "neutral"}>
                {overdue ? "期限切れ " : "期限 "}
                {formatCompactDate(task.dueDate)}
                {task.dueTime ? ` ${task.dueTime}` : ""}
              </Badge>
            )}
            {isRepeating(task.repeat) && <Badge tone="accent">{repeatLabel(task.repeat)}</Badge>}
            <Badge tone={category.tone}>{category.label}</Badge>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {canPostpone && (
            <button
              onClick={() => onPostpone!(task)}
              aria-label={`「${task.title}」の期日を明日にする`}
              className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <CalendarArrowDown size={14} />
              明日へ
            </button>
          )}
          {!indent && (
            <button
              onClick={() => task.id && onAddSubtask(task.id)}
              aria-label="サブタスク追加"
              className="rounded-full p-1.5 text-slate-300 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Plus size={16} />
            </button>
          )}
          <button
            onClick={handleDeleteClick}
            aria-label="削除"
            className="rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </ListRow>
      </SwipeRow>

      {subtasks.length > 0 && (
        <div className="mt-2 space-y-2">
          {subtasks.map((st) => (
            <TaskItem
              key={st.id}
              task={st}
              allTasks={allTasks}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}
