import { useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { FeedbackForm } from "./FeedbackForm";
import { FeedbackProgressList } from "./FeedbackProgressList";
import { useFeedbackCounts } from "../../hooks/useFeedbackProgress";

/** 「＋」(下端から5.5rem・高さ3.5rem)の上に0.75rem空けて重ねる。PCは「＋」が下端から2rem。 */
const IN_APP_POSITION = "bottom-[calc(env(safe-area-inset-bottom)+9.75rem-var(--viewport-gap,0px))] right-5 lg:bottom-[6.25rem] lg:right-8";

/** 「対応中」の印(脈打つ点)。動きを減らす設定の人には、止めた点で出す。 */
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
  // 直してもらっている最中は、「修正」が「対応中」になる(2026-10-13、本人「本当に直してるか分からない」。呼び名は 2026-10-14 に「修正中」から変えた)。
  const counts = useFeedbackCounts();
  const working = counts.working > 0;
  // 保留中(聞き返している・判断待ち)の依頼がある時は、対応中でなければ、「保留中」と出す。対応中のほうを先に出す。
  const held = counts.hold > 0 && !working;
  // 対応待ちの件数(2026-10-14、本人「対応待ち何件という表示も欲しい」)。何も手を付けていない依頼だけの時は、ボタンの名前そのものを「対応待ち N件」にする。
  const waitingText = counts.waiting > 0 ? `対応待ち ${counts.waiting}件` : "";
  const stateText = working ? "対応中" : held ? "保留中" : "";
  const label = stateText ? (waitingText ? `${stateText} ・ ${waitingText}` : stateText) : waitingText || "修正";
  const ariaState = [working ? "対応中です" : held ? "保留中の依頼があります" : "", counts.waiting > 0 ? `対応待ちの依頼が${counts.waiting}件あります` : ""].filter(Boolean).join("。");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaState ? `${ariaState}。直してほしいことを送る` : "直してほしいことを送る"}
        className={`feedback-button fixed ${position} z-40 flex transform-gpu items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3.5 py-2 text-xs font-semibold shadow-lg backdrop-blur transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${working ? "text-accent" : held ? "text-amber-700" : "text-slate-600"}`}
      >
        {working ? <WorkingDot /> : held ? <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" /> : <MessageSquarePlus size={15} aria-hidden="true" />}
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="直してほしいことを送る">
        {open && (
          <div className="flex flex-col gap-4">
            {/* 送った依頼が、いまどうなっているか(対応待ち・対応中・保留中・対応済み)。共有ページ(ログインなし)では出ない。 */}
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
 * アプリの中(右下の「＋」の上)に出す「修正」。持ち主(本人)にも出す。
 *
 * 2026-10-12 から持ち主には出していなかった(UI/UX 調査メモ A-1。本人は要望を設定の「届いた要望」で読むので、
 * 送る側の入口は要らず、「＋タスクを追加」などの上に重なって邪魔、という理由)。ところが、持ち主のアカウントで
 * 開くと「修正を送るボタンが消えてる」(2026-10-13、本人)。持ち主のアカウントでも、アプリの画面から依頼を送れて、
 * 直している最中は「対応中」と出るようにするため、全員に出す。
 */
export function InAppFeedbackButton() {
  return <FeedbackButton />;
}
