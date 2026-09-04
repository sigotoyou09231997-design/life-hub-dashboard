import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { db } from "../../db/schema";
import type { TripDocument } from "../../types";
import { loadAttachmentDrafts, saveAttachmentDrafts, type PhotoDraft } from "../../lib/attachments";
import { PhotoField } from "../attachments/PhotoField";
import { Input, Textarea } from "../ui/Input";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  tripId: string;
  initial?: TripDocument;
  /** 並びの最後に置くための、いま入っている件数。 */
  count: number;
  onSaved: () => void;
  onCancel: () => void;
}

export function TripDocumentForm({ tripId, initial, count, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [saving, setSaving] = useState(false);

  // 貼ってある写真は別のテーブルにあるので、開いたときに読み直す
  // (メモ・日記と同じ仕組み。src/lib/attachments.ts)。
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    loadAttachmentDrafts("tripDocument", initialId).then((drafts) => {
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
    const record: TripDocument = {
      tripId,
      title: title.trim(),
      body: body.trim() || undefined,
      sortOrder: initial?.sortOrder ?? count + 1,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    // 新しい書類にはまだidが無く、写真の貼り先を決められない。保存して得たidに
    // 向けて、そのあとで写真を書く(メモ・日記と同じ順番)。
    let documentId: string;
    if (initial?.id) {
      documentId = initial.id;
      await db.tripDocuments.put({ ...record, id: documentId });
    } else {
      documentId = String(await db.tripDocuments.add(record));
    }
    await saveAttachmentDrafts("tripDocument", documentId, photos);
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel>
        <Input
          label="何の控えか"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: パスポート"
          required
          autoFocus
        />
        <Textarea
          label="番号・住所など"
          optional
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="例: 予約番号 ABC-12345 / 宿の住所"
        />
      </FormPanel>

      <FormPanel caption="写真" icon={ImagePlus}>
        <PhotoField value={photos} onChange={setPhotos} />
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "書類を追加"}
        </Button>
      </FormActions>
    </form>
  );
}
