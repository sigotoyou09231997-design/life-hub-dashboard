// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: [{ clear: vi.fn(async () => undefined) }, { clear: vi.fn(async () => undefined) }],
}));

vi.mock("../db/schema", () => ({ db: { tables: mocks.tables } }));

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
});
