import { useState } from "react";
import type { NoteType } from "../../types";
import { NOTE_TYPE_DEFS } from "../../lib/noteTypes";
import { todayStr } from "../../lib/date";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { ExpenseForm } from "../expense/ExpenseForm";
import { EventForm } from "../calendar/EventForm";
import { TaskForm } from "../tasks/TaskForm";
import { MemoForm } from "../notes/MemoForm";
import { ChecklistForm } from "../notes/ChecklistForm";
import { ShoppingForm } from "../notes/ShoppingForm";

/** 「何を追加しますか?」で選べるもの。 */
export type QuickAddKind = "expense" | "event" | "task" | "note";

const NOTE_FORM_TITLE: Record<NoteType, string> = {
  memo: "メモを追加",
  checklist: "チェックリストを追加",
  shopping: "買い物リストを追加",
};

interface Props {
  /** 開いている入力。null なら全部閉じている。 */
  kind: QuickAddKind | null;
  onClose: () => void;
}

/**
 * 「何を追加しますか?」で選んだあとの入力シート。**今いる画面の上で開き、閉じたら元の画面のまま**。
 *
 * 以前は各画面へ ?new= 付きで移ってそこのフォームを開いていたので、ホームの「＋ → 支出」で
 * 入れ終わってもお金管理に残っていた(UI/UX 調査メモ 第3弾 N-3)。フォームは各画面と同じ部品を使う。
 * App の最初の読み込みを重くしないよう、AddChooser.tsx から初めて選ばれた時に読み込む(lazy)。
 */
export default function QuickAddForms({ kind, onClose }: Props) {
  const showToast = useToast();
  /** メモは種類(メモ・チェックリスト・買い物リスト)を選んでから入力を開く。 */
  const [noteType, setNoteType] = useState<NoteType | null>(null);

  function saved(message: string) {
    onClose();
    showToast(message);
  }

  function closeNote() {
    setNoteType(null);
    onClose();
  }

  function noteSaved() {
    setNoteType(null);
    saved("保存しました");
  }

  return (
    <>
      <Sheet open={kind === "expense"} onClose={onClose} title="収支を追加">
        {kind === "expense" && <ExpenseForm onSaved={() => saved("記録しました")} onCancel={onClose} />}
      </Sheet>

      <Sheet open={kind === "event"} onClose={onClose} title="予定を追加">
        {kind === "event" && (
          <EventForm defaultDate={todayStr()} onSaved={() => saved("予定を追加しました")} onCancel={onClose} />
        )}
      </Sheet>

      <Sheet open={kind === "task"} onClose={onClose} title="タスクを追加">
        {kind === "task" && <TaskForm onSaved={() => saved("タスクを追加しました")} onCancel={onClose} />}
      </Sheet>

      {/* メモ・リストの画面の「＋」と同じ選び方(NotePage.tsx)。 */}
      <Sheet open={kind === "note" && noteType === null} onClose={closeNote} title="何を追加しますか?">
        <div className="choice-grid choice-grid--three">
          {NOTE_TYPE_DEFS.map((def) => {
            const Icon = def.icon;
            return (
              <button key={def.value} type="button" onClick={() => setNoteType(def.value)} className="choice-grid__option">
                <span className="choice-grid__icon">
                  <Icon size={22} />
                </span>
                <strong>{def.label}</strong>
              </button>
            );
          })}
        </div>
      </Sheet>

      <Sheet open={kind === "note" && noteType !== null} onClose={closeNote} title={noteType ? NOTE_FORM_TITLE[noteType] : undefined}>
        {kind === "note" && noteType === "memo" && <MemoForm onSaved={noteSaved} onCancel={closeNote} />}
        {kind === "note" && noteType === "checklist" && <ChecklistForm onSaved={noteSaved} onCancel={closeNote} />}
        {kind === "note" && noteType === "shopping" && <ShoppingForm onSaved={noteSaved} onCancel={closeNote} />}
      </Sheet>
    </>
  );
}
