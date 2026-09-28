// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: [{ clear: vi.fn(async () => undefined) }, { clear: vi.fn(async () => undefined) }],
  withSyncSuppressed: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../db/schema", () => ({ db: { tables: mocks.tables } }));
vi.mock("./sync", () => ({ withSyncSuppressed: mocks.withSyncSuppressed }));

import { ensureDataOwner } from "./dataOwner";

describe("ensureDataOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("記録が無い端末では、既存のローカルデータを今のユーザーのものとして引き継ぐ", async () => {
    expect(await ensureDataOwner("user-a")).toBe(false);
    expect(mocks.tables[0].clear).not.toHaveBeenCalled();
    expect(localStorage.getItem("lifeHubDataOwner")).toBe("user-a");
  });

  it("同じユーザーの再ログインでは何も消さない", async () => {
    await ensureDataOwner("user-a");
    expect(await ensureDataOwner("user-a")).toBe(false);
    expect(mocks.tables[0].clear).not.toHaveBeenCalled();
  });

  it("別ユーザーがログインしたら全テーブルと同期カーソルを消す", async () => {
    await ensureDataOwner("user-a");
    localStorage.setItem("lifeHubLastSynced:notes", "2026-08-23T00:00:00.000Z");
    localStorage.setItem("lifeHubDeviceId", "device-1");

    expect(await ensureDataOwner("user-b")).toBe(true);
    for (const table of mocks.tables) expect(table.clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("lifeHubLastSynced:notes")).toBeNull();
    // 端末の識別子はユーザーのデータではないので残す。
    expect(localStorage.getItem("lifeHubDeviceId")).toBe("device-1");
    expect(localStorage.getItem("lifeHubDataOwner")).toBe("user-b");
  });

  it("空にする操作は、同期のフックに送り返させない(サーバー側までは消さない)", async () => {
    await ensureDataOwner("user-a");
    mocks.withSyncSuppressed.mockClear();

    await ensureDataOwner("user-b");

    // table.clear() 自体を withSyncSuppressed で包んでいることを確かめる — 包まずに
    // 直接呼ぶと、同期の登録済みテーブルでは1行ずつの削除として扱われ、次の同期で
    // サーバー側の行まで消えてしまう(2026-09-28に実際に起きた事故)。
    expect(mocks.withSyncSuppressed).toHaveBeenCalledTimes(1);
    for (const table of mocks.tables) expect(table.clear).toHaveBeenCalledTimes(1);
  });
});
