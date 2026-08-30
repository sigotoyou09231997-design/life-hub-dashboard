import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { NotebookPen, Plus } from "lucide-react";
import { db } from "../../db/schema";
import type { DiaryEntry, Note, NoteType } from "../../types";
import { NOTE_TYPE_DEFS, getNoteType } from "../../lib/noteTypes";
import { selectStandaloneDiaries } from "../../lib/diaryEntries";
import { AREA_ACCENT_STYLE } from "../../lib/areaColors";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Tabs } from "../../components/ui/Tabs";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { NoteList } from "../../components/notes/NoteList";
import { MemoForm } from "../../components/notes/MemoForm";
import { ChecklistForm } from "../../components/notes/ChecklistForm";
import { ShoppingForm } from "../../components/notes/ShoppingForm";
import { DiaryList } from "../../components/diary/DiaryList";
import { DiaryForm } from "../../components/diary/DiaryForm";
import { useToast } from "../../components/ui/ToastProvider";
import { ListSkeleton } from "../../components/ui/ListSkeleton";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

type Editing = { mode: "new"; type: NoteType } | { mode: "edit"; note: Note } | null;
type Tab = "notes" | "diary";

const FORM_TITLE: Record<NoteType, { new: string; edit: string }> = {
  memo: { new: "メモを追加", edit: "メモを編集" },
  checklist: { new: "チェックリストを追加", edit: "チェックリストを編集" },
  shopping: { new: "買い物リストを追加", edit: "買い物リストを編集" },
};

export default function NotePage() {
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>("notes");
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | "new" | null>(null);
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const showSkeleton = useDelayedFlag(notes === undefined);

  const diaryEntries = useLiveQuery(() => db.diaryEntries.toArray().then(selectStandaloneDiaries), []);
  const showDiarySkeleton = useDelayedFlag(diaryEntries === undefined);

  const editingType = editing ? (editing.mode === "new" ? editing.type : getNoteType(editing.note)) : null;
  const editingInitial = editing?.mode === "edit" ? editing.note : undefined;

  function closeEditing() {
    setEditing(null);
  }

  function handleSaved() {
    closeEditing();
    showToast("保存しました");
  }

  function handleDelete(id: string) {
    db.notes.delete(id);
    showToast("削除しました");
  }

  return (
    <div className="spatial-page notes-page micro-contrast pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.notes}>
      <PageHeader
        title="メモ・リスト"
        backTo="/"
        right={
          <button
            onClick={() => (tab === "diary" ? setEditingDiary("new") : setAddTypeOpen(true))}
            aria-label={tab === "diary" ? "日記を書く" : "メモ・リストを追加"}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors active:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Plus size={20} />
          </button>
        }
      />

      <div className="spatial-page-tabs mx-5 mb-4 lg:mx-8 lg:mb-6 lg:max-w-[420px]">
        <Tabs
          options={[
            { value: "notes", label: "メモ・リスト" },
            { value: "diary", label: "日記" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="spatial-page-content notes-workspace px-5 lg:px-8">
        {tab === "notes" &&
          (showSkeleton ? (
            <ListSkeleton />
          ) : (
            <NoteList
              notes={notes ?? []}
              onAdd={() => setAddTypeOpen(true)}
              onEdit={(note) => setEditing({ mode: "edit", note })}
              onDelete={handleDelete}
            />
          ))}

        {tab === "diary" &&
          (showDiarySkeleton ? (
            <ListSkeleton />
          ) : (diaryEntries ?? []).length === 0 ? (
            // 日記0件のときはこのカード1枚しか出ず、下に背景写真だけの帯が残る。
            // カードを画面の下まで伸ばす(.is-empty-fill、index.css)。
            <div className="is-empty-fill">
              <EmptyState
                icon={NotebookPen}
                title="日記はまだありません"
                description="旅行に関係なく、その日のことを残せます。"
                action={{ label: "日記を書く", onClick: () => setEditingDiary("new") }}
                card
              />
            </div>
          ) : (
            <>
              <DiaryList
                entries={diaryEntries ?? []}
                onEdit={(entry) => setEditingDiary(entry)}
                onDelete={(id) => {
                  db.diaryEntries.delete(id);
                  showToast("削除しました");
                }}
              />
              <Button className="mt-4 w-full" onClick={() => setEditingDiary("new")}>
                日記を書く
              </Button>
            </>
          ))}
      </div>

      <Sheet open={addTypeOpen} onClose={() => setAddTypeOpen(false)} title="何を追加しますか?">
        {/* 選ぶだけの画面なので、入力欄と同じ面ではなく「押す的」として見せる。 */}
        <div className="choice-grid choice-grid--three">
          {NOTE_TYPE_DEFS.map((def) => {
            const Icon = def.icon;
            return (
              <button
                key={def.value}
                type="button"
                onClick={() => {
                  setAddTypeOpen(false);
                  setEditing({ mode: "new", type: def.value });
                }}
                className="choice-grid__option"
              >
                <span className="choice-grid__icon">
                  <Icon size={22} />
                </span>
                <strong>{def.label}</strong>
              </button>
            );
          })}
        </div>
      </Sheet>

      <Sheet
        open={editing !== null}
        onClose={closeEditing}
        title={editingType ? FORM_TITLE[editingType][editing?.mode === "new" ? "new" : "edit"] : undefined}
      >
        {editingType === "memo" && (
          <MemoForm initial={editingInitial} onSaved={handleSaved} onCancel={closeEditing} />
        )}
        {editingType === "checklist" && (
          <ChecklistForm initial={editingInitial} onSaved={handleSaved} onCancel={closeEditing} />
        )}
        {editingType === "shopping" && (
          <ShoppingForm initial={editingInitial} onSaved={handleSaved} onCancel={closeEditing} />
        )}
      </Sheet>

      <Sheet
        open={editingDiary !== null}
        onClose={() => setEditingDiary(null)}
        title={editingDiary === "new" ? "日記を書く" : "日記を編集"}
      >
        {editingDiary && (
          <DiaryForm
            initial={editingDiary === "new" ? undefined : editingDiary}
            onSaved={() => {
              setEditingDiary(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingDiary(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
