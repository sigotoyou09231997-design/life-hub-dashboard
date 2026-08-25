// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 複数アカウントの土台そのもの: 端末内のデータをアカウントごとに分けているのは
 * 「アカウントによって開くIndexedDBの名前を変える」という一点だけなので、その一点を
 * ここで押さえる(切り替えの記録側は src/lib/accounts.test.ts)。 */
describe("アカウントごとのIndexedDB", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("記録の無い端末では、今まで通りの life-hub をそのまま開く", async () => {
    const { db } = await import("./schema");
    expect(db.name).toBe("life-hub");
  });

  it("1つ目のアカウントを選んでいるときも life-hub のまま(既存のデータを引き継ぐ)", async () => {
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([{ userId: "user-a", email: null, name: null, avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 }]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-a");

    const { db } = await import("./schema");
    expect(db.name).toBe("life-hub");
  });

  it("2つ目のアカウントを選んでいるときは、そのアカウント専用のDBを開く", async () => {
    localStorage.setItem(
      "lifeHubAccounts",
      JSON.stringify([
        { userId: "user-a", email: null, name: null, avatarUrl: null, slot: null, dbName: "life-hub", addedAt: 1 },
        { userId: "user-b", email: null, name: null, avatarUrl: null, slot: "user-b", dbName: "life-hub-user-b", addedAt: 2 },
      ]),
    );
    localStorage.setItem("lifeHubActiveAccount", "user-b");

    const { db } = await import("./schema");
    expect(db.name).toBe("life-hub-user-b");
  });
});
