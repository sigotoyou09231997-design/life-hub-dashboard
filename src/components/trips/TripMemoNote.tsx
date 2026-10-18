import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "../ui/Card";

/**
 * 旅行のメモ(日程タブの先頭)。ふだんは3行で畳み、「続きを読む」で全部出す。
 *
 * 2026-10-12 まで全文を出していたので、しおりの注意書きのような長いメモだと、日程が画面の下へ押し出されて
 * 開くたびにスクロールが要った。3行に収まるメモでは「続きを読む」は出さない(押しても何も増えないため)。
 */
export function TripMemoNote({ memo }: { memo: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();

  // 畳んでいる時に、3行からはみ出しているかを測る。幅が変わると折り返しも変わるので、大きさの変化でも測り直す。
  // 開いている間は測らない(全部出ているので、はみ出しが無いように見えてしまう)。
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [memo, open]);

  return (
    <Card className="trip-memo-note mb-3">
      <p className="text-xs text-slate-400">メモ</p>
      <p
        id={textId}
        ref={textRef}
        className={`trip-memo-note__text mt-0.5 whitespace-pre-wrap text-sm text-slate-700${open ? "" : " line-clamp-3"}`}
      >
        {memo}
      </p>
      {overflows && (
        <button
          type="button"
          className="trip-memo-note__toggle"
          aria-expanded={open}
          aria-controls={textId}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "閉じる" : "続きを読む"}
          {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      )}
    </Card>
  );
}
