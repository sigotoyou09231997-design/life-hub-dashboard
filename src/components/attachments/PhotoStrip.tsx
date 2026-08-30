import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Attachment } from "../../types";
import { useObjectUrls } from "../../hooks/useObjectUrls";

interface Props {
  attachments: Attachment[];
  /** 並べる枚数。超えたぶんは最後の1枚に「+n」として重ねる。 */
  limit?: number;
  /** 押すと1枚を大きく見る。メモの一覧のように、カード全体が編集ボタンに
   * なっている場所では立てない — 押しても編集が開いてしまう。 */
  interactive?: boolean;
  className?: string;
}

/** 貼ってある写真を並べる。レシートのように「後から中身を読む」写真があるので、
 * 押して大きく見られる場所では原寸で開けるようにする。 */
export function PhotoStrip({ attachments, limit = 4, interactive = false, className = "" }: Props) {
  const shown = attachments.slice(0, limit);
  const hidden = attachments.length - shown.length;
  // 表示用のURLは、並ぶ写真が入れ替わったときだけ作り直す。渡ってくる配列は
  // 描画のたびに作られ得るので、中身(idの並び)を鍵にする — 配列そのものを鍵に
  // すると毎描画でURLを作り直し、写真が点滅する。
  const key = shown.map((a) => a.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blobs = useMemo(() => shown.map((a) => a.blob), [key]);
  const urls = useObjectUrls(blobs);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <ul className={`photo-strip ${className}`}>
        {shown.map((attachment, index) => {
          const isLast = index === shown.length - 1 && hidden > 0;
          const content = (
            <>
              {urls[index] && <img src={urls[index]} alt={attachment.name} loading="lazy" />}
              {isLast && <span className="photo-strip__more">+{hidden}</span>}
            </>
          );
          return (
            <li key={attachment.id}>
              {interactive ? (
                <button type="button" onClick={() => setOpenIndex(index)} aria-label={`${attachment.name}を大きく見る`}>
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>

      {interactive && openIndex !== null && urls[openIndex] && (
        <div className="photo-viewer" role="dialog" aria-modal="true" onClick={() => setOpenIndex(null)}>
          <img src={urls[openIndex]} alt={shown[openIndex].name} />
          <button type="button" onClick={() => setOpenIndex(null)} aria-label="閉じる">
            <X size={18} />
          </button>
        </div>
      )}
    </>
  );
}
