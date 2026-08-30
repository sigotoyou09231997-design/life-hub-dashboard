import { useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  MAX_ATTACHMENTS_PER_ITEM,
  SUPPORTED_ATTACHMENT_MEDIA_TYPES,
  attachmentFileError,
  remainingSlots,
  toPhotoDraft,
  type PhotoDraft,
} from "../../lib/attachments";
import { useObjectUrls } from "../../hooks/useObjectUrls";
import { Button } from "../ui/Button";

interface Props {
  value: PhotoDraft[];
  onChange: (next: PhotoDraft[]) => void;
}

/**
 * メモ・日記に貼る写真を選ぶところ。ここでは端末の中に持つ形(縮めたJPEG)まで
 * 用意して呼び出し側の state に返すだけで、保存はしない — 新しく書いたメモには
 * まだidが無く、貼り先を決められないため(src/lib/attachments.ts)。
 */
export function PhotoField({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 表示用のURLは写真の入れ替わりでだけ作り直す。毎描画で作ると、貼るたびに
  // 全部の写真が一瞬消えて出直す。
  const blobs = useMemo(() => value.map((draft) => draft.blob), [value]);
  const urls = useObjectUrls(blobs);
  const slots = remainingSlots(value.length);

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const picked = [...files];
    // 上限を超えるぶんは黙って落とさず、何枚まで貼れるかを伝える。
    const accepted = picked.slice(0, slots);
    if (picked.length > accepted.length) {
      setError(`写真は${MAX_ATTACHMENTS_PER_ITEM}枚までです。`);
    }

    const usable: File[] = [];
    for (const file of accepted) {
      const reason = attachmentFileError(file);
      if (reason) setError(reason);
      else usable.push(file);
    }
    if (usable.length === 0) return;

    setBusy(true);
    try {
      const drafts = await Promise.all(usable.map(toPhotoDraft));
      onChange([...value, ...drafts]);
    } catch {
      setError("写真を読み込めませんでした。");
    } finally {
      setBusy(false);
    }
  }

  function handleRemove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="photo-field">
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_ATTACHMENT_MEDIA_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = ""; // 同じ写真を選び直せるようにリセット
        }}
      />

      {value.length > 0 && (
        <ul className="photo-field__grid">
          {value.map((draft, index) => (
            <li key={draft.id ?? `${draft.name}-${index}`}>
              {urls[index] && <img src={urls[index]} alt={draft.name} loading="lazy" />}
              <button type="button" onClick={() => handleRemove(index)} aria-label={`${draft.name}を外す`}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <Button
        type="button"
        variant="secondary"
        className="mt-2 w-full"
        disabled={busy || slots === 0}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={16} />
        {busy ? "読み込んでいます…" : slots === 0 ? `写真は${MAX_ATTACHMENTS_PER_ITEM}枚までです` : "写真を追加"}
      </Button>
      <p className="mt-2 text-[11px] text-slate-400">
        写真はこの端末の中だけに残ります(同期・バックアップには含まれません)。{MAX_ATTACHMENTS_PER_ITEM}枚まで。
      </p>
    </div>
  );
}
