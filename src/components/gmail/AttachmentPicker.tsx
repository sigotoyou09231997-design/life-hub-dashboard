import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { attachmentsTotalBytes, MAX_ATTACHMENTS_TOTAL_BYTES } from "../../lib/gmail";
import { useToast } from "../ui/ToastProvider";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/** Shared "ファイルを添付" control for both new-mail compose and reply forms — a hidden
 * file input plus a chip list of what's queued, each removable before send. Enforces
 * MAX_ATTACHMENTS_TOTAL_BYTES client-side so an oversized set is rejected immediately
 * with a clear message rather than after a slow upload that Gmail was going to refuse. */
export function AttachmentPicker({ files, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showToast = useToast();

  function handleFilesSelected(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    const merged = [...files, ...Array.from(selected)];
    if (attachmentsTotalBytes(merged) > MAX_ATTACHMENTS_TOTAL_BYTES) {
      showToast(`添付ファイルの合計サイズが大きすぎます(上限${formatBytes(MAX_ATTACHMENTS_TOTAL_BYTES)})`, "error");
      return;
    }
    onChange(merged);
  }

  function handleRemove(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          handleFilesSelected(e.target.files);
          e.target.value = ""; // 同じファイルを続けて選び直せるようにリセット
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="flex items-center gap-1.5 text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
      >
        <Paperclip size={14} />
        ファイルを添付
      </button>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.lastModified}-${i}`}
              className="flex items-center gap-1.5 rounded-full border border-white/50 bg-white/40 py-1 pl-3 pr-1.5 text-xs text-slate-600"
            >
              <span className="max-w-[9rem] truncate">{file.name}</span>
              <span className="shrink-0 text-slate-400">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                disabled={disabled}
                aria-label={`${file.name}を削除`}
                className="shrink-0 rounded-full p-0.5 text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
