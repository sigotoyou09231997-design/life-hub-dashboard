import { feedbackStatusLabel, type FeedbackItem } from "../../lib/appFeedback";
import { useFeedbackProgress } from "../../hooks/useFeedbackProgress";
import { Badge } from "../ui/Badge";

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

/** 行の下に出す補足。修正中は、いつから直しているかも添える(状態の札は短く保ち、依頼の文を潰さない)。 */
function subText(item: FeedbackItem): string {
  const sent = `${timeLabel(item.createdAt)} に送信`;
  return item.status === "working" && item.workingAt ? `${sent} ・ ${timeLabel(item.workingAt)} から修正中` : sent;
}

/**
 * 送った依頼の「いま」。直している最中は「修正中」と、いつから直しているかが出る(src/lib/feedbackProgress.ts が開いている間、読み直す)。
 * 本当に直してくれているのか分からない、をなくすための表示。何も送っていない人には何も出ない。
 */
export function FeedbackProgressList() {
  const items = useFeedbackProgress();
  if (items.length === 0) return null;
  return (
    <section aria-label="送った依頼の状況">
      <h3 className="text-xs font-semibold text-slate-600">送った依頼の状況</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {items.slice(0, 5).map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-2 text-sm text-slate-700">
            <span className="min-w-0">
              <span className="block truncate">{summary(item.message)}</span>
              <span className="text-xs text-slate-500">{subText(item)}</span>
            </span>
            <Badge tone={item.status === "working" ? "accent" : "neutral"} className="shrink-0 whitespace-nowrap">
              {feedbackStatusLabel(item.status)}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
