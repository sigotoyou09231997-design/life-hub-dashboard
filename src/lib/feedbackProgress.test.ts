// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackItem } from "./appFeedback";

const mocks = vi.hoisted(() => ({ items: [] as FeedbackItem[], loads: 0 }));

vi.mock("./appFeedback", async () => {
  const actual = await vi.importActual<typeof import("./appFeedback")>("./appFeedback");
  return {
    ...actual,
    loadRecentFeedback: async () => {
      mocks.loads += 1;
      return mocks.items;
    },
  };
});

import { notifyFeedbackChanged } from "./appFeedback";
import {
  FEEDBACK_POLL_MS,
  getFeedbackProgressSnapshot,
  resetFeedbackProgressForTests,
  subscribeFeedbackProgress,
} from "./feedbackProgress";

const item = (id: string, status: FeedbackItem["status"], extra: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id,
  via: "app",
  message: "直して",
  status,
  createdAt: "2026-10-13T03:00:00Z",
  ...extra,
});

/** 読み出し(非同期)が済むまで待つ。 */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

describe("feedbackProgress(修正依頼の状況を、開いている間、読み続ける)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFeedbackProgressForTests();
    mocks.items = [];
    mocks.loads = 0;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => {
    resetFeedbackProgressForTests();
    vi.useRealTimers();
  });

  it("画面が見始めた時に1回読み、結果を控えて、見ている画面に知らせる", async () => {
    mocks.items = [item("a", "working", { workingAt: "2026-10-13T03:10:00Z" })];
    const listener = vi.fn();
    const stop = subscribeFeedbackProgress(listener);
    await settle();
    expect(mocks.loads).toBe(1);
    expect(getFeedbackProgressSnapshot().map((entry) => entry.status)).toEqual(["working"]);
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it("終わっていない依頼(受け付け済み・修正中)がある間は、30秒ごとに読み直し、状態が変わったら知らせる", async () => {
    mocks.items = [item("a", "new")];
    const listener = vi.fn();
    const stop = subscribeFeedbackProgress(listener);
    await settle();
    expect(getFeedbackProgressSnapshot()[0].status).toBe("new");

    mocks.items = [item("a", "working")];
    await vi.advanceTimersByTimeAsync(FEEDBACK_POLL_MS);
    expect(mocks.loads).toBe(2);
    expect(getFeedbackProgressSnapshot()[0].status).toBe("working");
    expect(listener).toHaveBeenCalledTimes(2);

    // 変わらない読み直しでは、知らせない(画面を無駄に描き直さない)
    await vi.advanceTimersByTimeAsync(FEEDBACK_POLL_MS);
    expect(mocks.loads).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("全部終わっている(対応済み・見送り)か、何も送っていなければ、読み直し続けない", async () => {
    mocks.items = [item("a", "done"), item("b", "dismissed")];
    const stop = subscribeFeedbackProgress(() => {});
    await settle();
    await vi.advanceTimersByTimeAsync(FEEDBACK_POLL_MS * 3);
    expect(mocks.loads).toBe(1);
    stop();
  });

  it("依頼を送った・状態を変えた時(notifyFeedbackChanged)は、すぐ読み直す", async () => {
    const stop = subscribeFeedbackProgress(() => {});
    await settle();
    expect(mocks.loads).toBe(1);
    mocks.items = [item("n", "new")];
    notifyFeedbackChanged();
    await settle();
    expect(mocks.loads).toBe(2);
    expect(getFeedbackProgressSnapshot()).toHaveLength(1);
    stop();
  });

  it("見ている画面が1つも無くなったら、読み直しを止める。複数の画面が見ていても、読み出しは1つ", async () => {
    mocks.items = [item("a", "working")];
    const stopA = subscribeFeedbackProgress(() => {});
    const stopB = subscribeFeedbackProgress(() => {});
    await settle();
    expect(mocks.loads).toBe(1);
    stopA();
    await vi.advanceTimersByTimeAsync(FEEDBACK_POLL_MS);
    expect(mocks.loads).toBe(2);
    stopB();
    await vi.advanceTimersByTimeAsync(FEEDBACK_POLL_MS * 3);
    expect(mocks.loads).toBe(2);
  });

  it("アプリに戻ってきた(見える状態になった)時に、すぐ読み直す", async () => {
    mocks.items = [item("a", "working")];
    const stop = subscribeFeedbackProgress(() => {});
    await settle();
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mocks.loads).toBe(2);
    stop();
  });
});
