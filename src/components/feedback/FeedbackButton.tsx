import { useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { FeedbackForm } from "./FeedbackForm";
import { useIsFeedbackOwner } from "../../hooks/useIsFeedbackOwner";

interface Props {
  /** 共有した「しおり」のページから使う時の合鍵(ログインしていない人が送れるように)。 */
  shareToken?: string;
  /** アプリの外枠(下のタブバー・右下の「＋」)が無い画面で使う時。右下の角に置く。 */
  standalone?: boolean;
}

/**
 * 「ここ直した方がいい」を送る入口。右下の「＋」(src/components/ui/PageFab.tsx)の真上に置く
 * (2026-10-11、本人の指定「右下のボタンの上くらいに修正ボタン」)。「＋」と同じく、
 * App のページの外の置き場に出しているので、ページを切り替えても動かない。
 */
export function FeedbackButton({ shareToken, standalone = false }: Props) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const showToast = useToast();

  // 「＋」(下端から5.5rem・高さ3.5rem)の上に0.75rem空けて重ねる。PCは「＋」が下端から2rem。
  const position = standalone
    ? "bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] right-5 lg:bottom-8 lg:right-8"
    : "bottom-[calc(env(safe-area-inset-bottom)+9.75rem-var(--viewport-gap,0px))] right-5 lg:bottom-[6.25rem] lg:right-8";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="直してほしいことを送る"
        className={`feedback-button fixed ${position} z-40 flex transform-gpu items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-lg backdrop-blur transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}
      >
        <MessageSquarePlus size={15} aria-hidden="true" />
        修正
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="直してほしいことを送る">
        {open && (
          <FeedbackForm
            page={location.pathname}
            shareToken={shareToken}
            onSent={() => {
              setOpen(false);
              showToast("送りました。ありがとうございます");
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </Sheet>
    </>
  );
}

/**
 * アプリの中(右下の「＋」の上)に出す「修正」。**持ち主(本人)には出さない**(2026-10-12、
 * UI/UX 調査メモ A-1)。本人は要望を設定の「届いた要望」で読むので送る側の入口は要らず、
 * 出ていると「＋タスクを追加」「CSVで書き出す」などの上に重なって邪魔になっていた。
 * 持ち主かどうか分かるまでは出さない — 本人の画面で一瞬出てから消えるのを避けるため
 * (ほかの人には、問い合わせが返った時点で出る)。
 */
export function InAppFeedbackButton() {
  const isOwner = useIsFeedbackOwner();
  if (isOwner !== false) return null;
  return <FeedbackButton />;
}
