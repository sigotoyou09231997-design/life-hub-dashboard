import { useEffect, useState } from "react";
import { CalendarPlus, ImagePlus } from "lucide-react";
import { db } from "../../db/schema";
import type { Note } from "../../types";
import { loadAttachmentDrafts, saveAttachmentDrafts, type PhotoDraft } from "../../lib/attachments";
import { detectNotePlan } from "../../lib/notePlanSuggestion";
import { formatDisplayDate } from "../../lib/date";
import { useToast } from "../ui/ToastProvider";
import { PhotoField } from "../attachments/PhotoField";
import { Input, Textarea } from "../ui/Input";
import { SwitchField } from "../ui/SwitchField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";
import { CategorySelect } from "./CategorySelect";
import { NOTE_CATEGORIES } from "../../lib/categories";

interface Props {
  initial?: Note;
  onSaved: () => void;
  onCancel: () => void;
}

/** 本文欄の高さ(行数)。住所のように数行のテキストを入れたとき、枠の中で
 *  スクロールしないと下が見えない状態を避けるため、入っている行数に合わせて伸ばす。
 *  伸びっぱなしだと下のカテゴリ・タグが遠くなるので上限を置く。 */
export function memoBodyRows(body: string): number {
  return Math.min(20, Math.max(8, body.split("\n").length + 1));
}

export function MemoForm({ initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [tagsInput, setTagsInput] = useState(initial?.tags.join(", ") ?? "");
  const [category, setCategory] = useState(initial?.category ?? NOTE_CATEGORIES[0]);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  // 「今はしない」を押した提案。このフォームを開いている間だけ覚える —
  // 本文を書き換えれば別の日付になり得るので、覚え続ける値ではない。
  const [dismissedPlan, setDismissedPlan] = useState<string | null>(null);
  const [addedPlan, setAddedPlan] = useState<string | null>(null);

  // 依頼のとおり、判定するのは本文をこの画面で変えたときだけ。開いただけの
  // 既存メモに提案を出すと、昔書いたメモを見るたびに同じ提案が出続ける。
  const bodyChanged = body !== (initial?.body ?? "");
  const plan = bodyChanged ? detectNotePlan(body) : null;
  const planKey = plan ? `${plan.date}${plan.time ?? ""}` : null;
  const showPlan = Boolean(plan) && planKey !== dismissedPlan && planKey !== addedPlan;

  // 貼ってある写真は本文と別のテーブルに置いてあるので、開いたときに読み直す
  // (src/lib/attachments.ts)。
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    loadAttachmentDrafts("note", initialId).then((drafts) => {
      if (alive) setPhotos(drafts);
    });
    return () => {
      alive = false;
    };
  }, [initialId]);

  /** 提案から予定を1件作る。メモの方は触らない — 予定に入れたからといって、
   * 書いたメモを消したり書き換えたりする理由は無い。 */
  async function handleAddPlan() {
    if (!plan) return;
    await db.calendarEvents.add({
      title: title.trim() || "メモから追加した予定",
      date: plan.date,
      startTime: plan.time,
      allDay: !plan.time,
      memo: `メモ「${title.trim() || "無題"}」から追加`,
      category: "other",
      createdAt: Date.now(),
    });
    setAddedPlan(planKey);
    showToast("予定に追加しました");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    const now = Date.now();
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const record: Note = {
      type: "memo",
      title: title.trim(),
      body,
      tags,
      category,
      pinned,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };

    // 新しいメモにはまだidが無く、写真の貼り先を決められない。保存して得たidに
    // 向けて、そのあとで写真を書く(src/lib/attachments.ts)。
    let noteId: string;
    if (initial?.id) {
      noteId = initial.id;
      await db.notes.put({ ...record, id: noteId });
    } else {
      noteId = String(await db.notes.add(record));
    }
    await saveAttachmentDrafts("note", noteId, photos);
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel>
        <Input
          label="タイトル"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 引っ越しの持ち物"
          required
          autoFocus
        />
        <Textarea
          label="本文"
          optional
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={memoBodyRows(body)}
        />
        {showPlan && plan && (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <CalendarPlus size={14} />
              予定に追加しますか?
            </p>
            <p className="mt-1 text-xs text-slate-500">
              本文に「{plan.hint}」とあります。{formatDisplayDate(plan.date)}
              {plan.time ? ` ${plan.time}` : "(終日)"}で追加します。
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button type="button" onClick={handleAddPlan}>
                予定に追加
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDismissedPlan(planKey)}>
                今はしない
              </Button>
            </div>
          </div>
        )}
      </FormPanel>

      <FormPanel caption="写真" icon={ImagePlus}>
        <PhotoField value={photos} onChange={setPhotos} />
      </FormPanel>

      <FormPanel caption="整理のしかた">
        <CategorySelect value={category} onChange={setCategory} />
        <Input
          label="タグ"
          optional
          hint="カンマで区切ると複数付けられます。"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="例: 買い物, 仕事"
        />
        <SwitchField label="ピン留めする" hint="一覧のいちばん上に出します。" checked={pinned} onChange={setPinned} />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "メモを追加"}
        </Button>
      </FormActions>
    </form>
  );
}
