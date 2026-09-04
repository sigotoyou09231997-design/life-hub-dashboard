import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, ChevronUp, FileLock2, Trash2 } from "lucide-react";
import { db } from "../../db/schema";
import type { TripDocument } from "../../types";
import { groupByOwner } from "../../lib/attachments";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { PhotoStrip } from "../attachments/PhotoStrip";

interface Props {
  documents: TripDocument[];
  onEdit: (document: TripDocument) => void;
  onDelete: (document: TripDocument) => void;
  onReorder: (index: number, direction: -1 | 1) => void;
}

export function TripDocumentList({ documents, onEdit, onDelete, onReorder }: Props) {
  // 貼ってある写真は1件ずつ引かず、この種類ぶんを一度に読んでから配る
  // (src/lib/attachments.ts の groupByOwner)。
  const attachments = useLiveQuery(() => db.attachments.where("ownerType").equals("tripDocument").toArray(), []);
  const photosByDocument = groupByOwner(attachments ?? []);

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileLock2}
        title="書類はまだありません"
        description="パスポート番号や予約の控えを、この旅行にひもづけて置いておけます。この端末の中だけに保存され、同期もバックアップもされません。"
      />
    );
  }

  return (
    <div className="space-y-2">
      {documents.map((document, index) => (
        <ListRow key={document.id} className="p-3.5">
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => onEdit(document)}
              aria-label={`「${document.title}」を編集`}
              className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <p className="text-sm font-medium text-slate-900">{document.title}</p>
              {document.body && (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{document.body}</p>
              )}
            </button>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => onReorder(index, -1)}
                disabled={index === 0}
                aria-label="上へ"
                className="rounded-full p-1 text-slate-300 transition-colors disabled:opacity-30 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                onClick={() => onReorder(index, 1)}
                disabled={index === documents.length - 1}
                aria-label="下へ"
                className="rounded-full p-1 text-slate-300 transition-colors disabled:opacity-30 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(document)}
                aria-label="削除"
                className="rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {/* 写真は押して原寸で開けるようにする — 予約票やパスポートの面は、
              並んだ小さい画のままでは番号が読めない。 */}
          <PhotoStrip attachments={photosByDocument.get(document.id!) ?? []} interactive className="mt-2.5" />
        </ListRow>
      ))}
    </div>
  );
}
