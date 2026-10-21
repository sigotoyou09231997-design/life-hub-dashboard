/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleted = vi.hoisted(() => [] as { table: string; column: string; value: string }[]);
vi.mock("./supabaseData", () => ({
  getSupabaseDataClient: async () => ({
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, value: string) => {
          deleted.push({ table, column, value });
          return { error: null };
        },
      }),
    }),
  }),
}));

const { retirePushSubscription } = await import("./pushNotifications");

beforeEach(() => {
  deleted.length = 0;
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("画面外の通知をやめた後の片付け(retirePushSubscription)", () => {
  it("この人の購読と、Gmail を見張るために預けた鍵の控えを消し、端末の購読も外す", async () => {
    const unsubscribe = vi.fn(async () => true);
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: "e1", unsubscribe }) } }) },
    });
    await retirePushSubscription("user-1");
    expect(deleted).toEqual([
      { table: "push_subscriptions", column: "user_id", value: "user-1" },
      { table: "gmail_server_accounts", column: "user_id", value: "user-1" },
    ]);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("済んだ端末では、もう何もしない", async () => {
    await retirePushSubscription("user-1");
    deleted.length = 0;
    await retirePushSubscription("user-1");
    expect(deleted).toEqual([]);
  });
});
