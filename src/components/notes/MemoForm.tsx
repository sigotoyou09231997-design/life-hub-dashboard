import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { db } from "../../db/schema";
import type { Note } from "../../types";
import { loadAttachmentDrafts, saveAttachmentDrafts, type PhotoDraft } from "../../lib/attachments";
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
