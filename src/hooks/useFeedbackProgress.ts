import { useSyncExternalStore } from "react";
import type { FeedbackItem } from "../lib/appFeedback";
import { getFeedbackProgressSnapshot, subscribeFeedbackProgress } from "../lib/feedbackProgress";

/** 自分が見られる、最近の修正依頼(送った人は自分の分、持ち主は全部)。状態は開いている間、新しくなる。 */
export function useFeedbackProgress(): readonly FeedbackItem[] {
  return useSyncExternalStore(subscribeFeedbackProgress, getFeedbackProgressSnapshot, getFeedbackProgressSnapshot);
}

/** いま修正中の依頼。 */
export function useWorkingFeedback(): FeedbackItem[] {
  return useFeedbackProgress().filter((item) => item.status === "working");
}
