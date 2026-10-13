import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { FeedbackForm } from "./FeedbackForm";
import { FeedbackProgressList } from "./FeedbackProgressList";
import { useIsFeedbackOwner } from "../../hooks/useIsFeedbackOwner";
import { useWorkingFeedback } from "../../hooks/useFeedbackProgress";

/** 「＋」(下端から5.5rem・高さ3.5rem)の上に0.75rem空けて重ねる。PCは「＋」が下端から2rem。 */
const IN_APP_POSITION = "bottom-[calc(env(safe-area-inset-bottom)+9.75rem-var(--viewport-gap,0px))] right-5 lg:bottom-[6.25rem] lg:right-8";

/** 「修正中」の印(脈打つ点)。動きを減らす設定の人には、止めた点で出す。 */
function WorkingDot() {
  return (
    <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
    </span>
  );
}

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

  const position = standalone ? "bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] right-5 lg:bottom-8 lg:right-8" : IN_APP_POSITION;
  // 直してもらっている最中は、「修正」が「修正中」になる(2026-10-13、本人「本当に直してるか分からない」)。
  const working = useWorkingFeedback().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={working ? "修正中です。直してほしいことを送る" : "直してほしいことを送る"}
        className={`feedback-button fixed ${position} z-40 flex transform-gpu items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3.5 py-2 text-xs font-semibold shadow-lg backdrop-blur transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${working ? "text-accent" : "text-slate-600"}`}
      >
        {working ? <WorkingDot /> : <MessageSquarePlus size={15} aria-hidden="true" />}
        {working ? "修正中" : "修正"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="直してほしいことを送る">
        {open && (
          <div className="flex flex-col gap-4">
            {/* 送った依頼が、いまどうなっているか(受け付け済み・修正中・対応済み)。共有ページ(ログインなし)では出ない。 */}
            {!shareToken && <FeedbackProgressList />}
            <FeedbackForm
              page={location.pathname}
              shareToken={shareToken}
              onSent={() => {
                setOpen(false);
                showToast("送りました。ありがとうございます");
              }}
              onCancel={() => setOpen(false)}
            />
          </div>
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

/**
 * 持ち主(本人)の画面の「修正中 N件」。持ち主には「修正」ボタンを出さない(上)ので、直している最中だけ、同じ場所に出す。
 * 押すと、設定の「届いた要望」へ。直し終わる(対応済み・見送り・未対応に戻す)と消える。
 */
export function InAppFeedbackProgress() {
  const isOwner = useIsFeedbackOwner();
  const working = useWorkingFeedback();
  const location = useLocation();
  // 「届いた要望」(設定)を開いている間は、その一覧に「修正中」が出ているので、札は出さない。
  if (isOwner !== true || working.length === 0 || location.pathname === "/settings") return null;
  return (
    <Link
      to="/settings"
      aria-label={`修正中が${working.length}件あります。届いた要望を開く`}
      className={`feedback-button fixed ${IN_APP_POSITION} z-40 flex transform-gpu items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3.5 py-2 text-xs font-semibold text-accent shadow-lg backdrop-blur transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}
    >
      <WorkingDot />
      修正中 {working.length}件
    </Link>
  );
}
