import { useState } from "react";
import { answerFeedback, feedbackStatusLabel, FeedbackError, type FeedbackItem } from "../../lib/appFeedback";
import { useFeedbackCounts, useFeedbackProgress } from "../../hooks/useFeedbackProgress";
import { isActiveFeedback } from "../../lib/feedbackProgress";
import { agoLabel } from "../../lib/feedbackTime";
import { useNow } from "../../hooks/useNow";
import { useIsFeedbackOwner } from "../../hooks/useIsFeedbackOwner";
import { Badge } from "../ui/Badge";
import { FeedbackGauge } from "./FeedbackGauge";

/** 「M/d H:mm」(日本時間ではなく、この端末の時刻)。 */
function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function summary(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > 36 ? `${oneLine.slice(0, 36)}…` : oneLine;
}

/**
 * 行の下に出す補足。いつ届いたか(2026-10-14、本人「いつ修正依頼が届いたかの時間も出して欲しい」)。
 * まだ終わっていない依頼は、届いてからの経過も添える(「対応待ちが、どれくらい待っているか」が分かる)。
 * 対応中は、いつから直しているかも次の行に添える(狭い画面で、時刻の途中で折り返さないように。状態の札は短く保ち、依頼の文を潰さない)。
 */
function subText(item: FeedbackItem, nowMs: number): { arrived: string; working?: string } {
  const ago = isActiveFeedback(item) ? agoLabel(item.createdAt, nowMs) : "";
  const arrived = `${timeLabel(item.createdAt)} に届きました${ago ? `（${ago}）` : ""}`;
  return item.status === "working" && item.workingAt ? { arrived, working: `${timeLabel(item.workingAt)} から対応中` } : { arrived };
}

/**
 * 保留中の質問に答えるボタン(2026-10-14、持ち主「質問者がボタンを押したらその回答がこっちに送信されるように」。supabase/sql/039)。
 * 質問の文は statusNote、選択肢は questionOptions。押すと答えが持ち主に送られて、依頼は「対応待ち」に戻る。
 * 一度押したら、返事が来るまで押せない(二重に送らない)。失敗したら理由を出して、もう一度押せる。
 */
function QuestionButtons({ item }: { item: FeedbackItem }) {
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (item.status !== "hold" || !item.questionOptions || item.questionOptions.length < 2) return null;

  async function answer(option: string) {
    setSending(option);
    setError("");
    try {
      await answerFeedback(item.id, option);
    } catch (err) {
      setError(err instanceof FeedbackError ? err.message : "送れませんでした。もう一度お試しください");
      setSending(null);
    }
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5" role="group" aria-label="質問への答え">
      {item.questionOptions.map((option) => (
        <button
          key={option}
          type="button"
          disabled={sending !== null}
          onClick={() => void answer(option)}
          className="rounded-xl border border-accent/30 bg-white/80 px-3 py-2 text-left text-sm font-medium text-accent active:bg-accent/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {sending === option ? "送っています…" : option}
        </button>
      ))}
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * 送った依頼の「いま」。直している最中は「対応中」と、いつから直しているかが出る(src/lib/feedbackProgress.ts が開いている間、読み直す)。
 * 本当に直してくれているのか分からない、をなくすための表示。何も送っていない人には何も出ない。
 */
export function FeedbackProgressList() {
  const all = useFeedbackProgress();
  const counts = useFeedbackCounts();
  // 「○分前」を、開いたまま進める。
  const now = useNow(30_000);
  // まだ終わっていない依頼を先に並べる(古い対応待ちが、新しい対応済みの後ろに隠れて、件数と一覧が食い違わないように)。新しい順はそのまま。
  const items = [...all.filter(isActiveFeedback), ...all.filter((item) => !isActiveFeedback(item))];
  // 持ち主には、ほかの人が送った依頼も含めて全部が返る(RLS)ので、「送った」とは言わない。
  const owner = useIsFeedbackOwner() === true;
  const heading = owner ? "届いている依頼の状況" : "送った依頼の状況";
  if (items.length === 0) return null;
  return (
    <section aria-label={heading}>
      <h3 className="text-xs font-semibold text-slate-600">{heading}</h3>
      {/* 件数(2026-10-14、本人「対応待ち何件という表示も欲しい」)。0件の状態は出さない。 */}
      {(counts.waiting > 0 || counts.working > 0 || counts.hold > 0) && (
        <p className="mt-1 text-xs font-semibold text-slate-700" data-testid="feedback-counts">
          {[counts.waiting > 0 && `対応待ち ${counts.waiting}件`, counts.working > 0 && `対応中 ${counts.working}件`, counts.hold > 0 && `保留中 ${counts.hold}件`].filter(Boolean).join(" ・ ")}
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {items.slice(0, 8).map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-2 text-sm text-slate-700">
            <div className="min-w-0 flex-1">
              <span className="block truncate">{summary(item.message)}</span>
              {(() => {
                const sub = subText(item, now);
                return (
                  <span className="block text-xs text-slate-500">
                    <span className="block">{sub.arrived}</span>
                    {sub.working && <span className="block">{sub.working}</span>}
                  </span>
                );
              })()}
              {/* 保留中の理由・聞きたいこと(あれば)。送った人が、何を答えればいいか分かるように。 */}
              {item.status === "hold" && item.statusNote && <span className="mt-0.5 block text-xs text-amber-800">{item.statusNote}</span>}
              {/* 質問のボタン(保留中で、選択肢が付いている時だけ)。 */}
              <QuestionButtons item={item} />
              {/* 答えたあと(対応待ちに戻っている間)は、何と答えたかを出す。 */}
              {item.status !== "hold" && item.answer && <span className="mt-0.5 block text-xs text-slate-600">あなたの答え: {item.answer}</span>}
              {/* 対応中の依頼の、かかる時間の目安と経過のゲージ(目安が付いている時だけ)。 */}
              <FeedbackGauge item={item} />
            </div>
            <Badge tone={item.status === "working" ? "accent" : item.status === "hold" ? "warning" : "neutral"} className="shrink-0 whitespace-nowrap">
              {feedbackStatusLabel(item.status)}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
