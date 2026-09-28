// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: [
    { name: "notes", clear: vi.fn(async () => undefined), toArray: vi.fn(async () => [{ id: "n1" }]) },
    { name: "tasks", clear: vi.fn(async () => undefined), toArray: vi.fn(async () => [{ id: "t1" }]) },
  ],
  withSyncSuppressed: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  backupBulkPut: vi.fn(async () => undefined),
}));

vi.mock("../db/schema", () => ({ db: { tables: mocks.tables } }));
vi.mock("./sync", () => ({ withSyncSuppressed: mocks.withSyncSuppressed }));
// 控え先は本物のIndexedDBを使わず、呼び出しの形だけ確かめる(jsdomにIndexedDBの
// 実装が無いテスト環境のため)。
vi.mock("dexie", () => ({
  default: class MockDexie {
    constructor(public name: string) {}
    version() {
      return { stores: () => undefined };
    }
    table() {
      return { bulkPut: mocks.backupBulkPut };
    }
    close() {}
  },
}));

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

  it("空にする前に、中身をまるごと控えへ退避する(判定が誤りだった時の最後の砦)", async () => {
    // 2026-09-28の事故では、この控えが無かったため、消えたと分かった時点で
    // サーバー側のSQLを直接書いて戻すしかなかった(給与4件など)。
    await ensureDataOwner("user-a");
    mocks.backupBulkPut.mockClear();

    expect(await ensureDataOwner("user-b")).toBe(true);

    expect(mocks.backupBulkPut).toHaveBeenCalledTimes(1);
    expect(mocks.backupBulkPut).toHaveBeenCalledWith([
      { name: "notes", rows: [{ id: "n1" }] },
      { name: "tasks", rows: [{ id: "t1" }] },
    ]);
  });

  it("消さない時(同じユーザーや初回)は、控えも作らない", async () => {
    expect(await ensureDataOwner("user-a")).toBe(false);
    expect(mocks.backupBulkPut).not.toHaveBeenCalled();

    expect(await ensureDataOwner("user-a")).toBe(false);
    expect(mocks.backupBulkPut).not.toHaveBeenCalled();
  });
});
