import { feedbackStatusLabel, type FeedbackItem } from "../../lib/appFeedback";
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
