import { useMemo, useSyncExternalStore } from "react";
import type { FeedbackItem } from "../lib/appFeedback";
import { countFeedback, getFeedbackProgressSnapshot, subscribeFeedbackProgress, type FeedbackCounts } from "../lib/feedbackProgress";

/** 自分が見られる、最近の修正依頼(送った人は自分の分、持ち主は全部)。状態は開いている間、新しくなる。 */
export function useFeedbackProgress(): readonly FeedbackItem[] {
  return useSyncExternalStore(subscribeFeedbackProgress, getFeedbackProgressSnapshot, getFeedbackProgressSnapshot);
}

/** 対応待ち・対応中・保留中の件数。 */
export function useFeedbackCounts(): FeedbackCounts {
  const items = useFeedbackProgress();
  return useMemo(() => countFeedback(items), [items]);
}

/** いま対応中の依頼。 */
export function useWorkingFeedback(): FeedbackItem[] {
  return useFeedbackProgress().filter((item) => item.status === "working");
}

/** いま保留中の依頼(聞き返している・判断待ち)。 */
export function useHeldFeedback(): FeedbackItem[] {
  return useFeedbackProgress().filter((item) => item.status === "hold");
}
