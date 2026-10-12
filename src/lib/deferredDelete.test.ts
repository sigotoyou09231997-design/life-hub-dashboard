// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMITTED_UNHIDE_DELAY_MS,
  commitPendingDeletes,
  deferDelete,
  getPendingDeletes,
  hasInterruptedDeletes,
  isPendingDelete,
  replayInterruptedDeletes,
  subscribePendingDeletes,
  withoutPendingDeletes,
} from "./deferredDelete";
import { scopedKey } from "./accounts";

// UI/UX 調査メモ 第4弾 A-2: 削除は押した時に隠すだけで、本当に消すのは後(お知らせが閉じた時)。
// 元に戻すは DB に何も書かない — 同期(src/lib/sync.ts)に「消して入れ直す」を流さないための作り。

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  // 前のテストで待たせたままの削除を片付け、隠している印も消えるまで進める。
  await commitPendingDeletes();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

describe("あとで消す削除(deferDelete)", () => {
  it("押した時は隠すだけで、DB の削除(commit)はまだ呼ばない", () => {
    const commit = vi.fn();
    deferDelete([{ table: "tasks", id: "t1" }], commit);

    expect(isPendingDelete("tasks", "t1")).toBe(true);
    expect(isPendingDelete("tasks", "t2")).toBe(false);
    expect(isPendingDelete("notes", "t1")).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it("元に戻すと隠すのをやめるだけ。そのあと commit しても消さない", async () => {
    const commit = vi.fn();
    const pending = deferDelete([{ table: "notes", id: "n1" }], commit);

    expect(pending.undo()).toBe(true);
    expect(isPendingDelete("notes", "n1")).toBe(false);
    expect(pending.status).toBe("undone");

    await pending.commit();
    expect(commit).not.toHaveBeenCalled();
  });

  it("commit は何度呼んでも1回だけ消す。消し終わってから少しの間は隠したまま(読み直し待ち)", async () => {
    const commit = vi.fn(async () => {});
    const pending = deferDelete([{ table: "tasks", id: "t1" }, { table: "tasks", id: "child" }], commit);

    await Promise.all([pending.commit(), pending.commit()]);
    await pending.commit();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(pending.status).toBe("committed");
    // 消した直後に外すと、useLiveQuery が読み直すまでの一瞬だけ行が戻って見えるため。
    expect(isPendingDelete("tasks", "t1")).toBe(true);
    expect(isPendingDelete("tasks", "child")).toBe(true);

    await vi.advanceTimersByTimeAsync(COMMITTED_UNHIDE_DELAY_MS);
    expect(isPendingDelete("tasks", "t1")).toBe(false);
    expect(isPendingDelete("tasks", "child")).toBe(false);
  });

  it("消し始めた後の元に戻すは効かない(false)", async () => {
    const pending = deferDelete([{ table: "tasks", id: "t1" }], async () => {});
    await pending.commit();
    expect(pending.undo()).toBe(false);
  });

  it("消すのに失敗したら、すぐ見えるように戻して失敗を伝える", async () => {
    const pending = deferDelete([{ table: "tasks", id: "t1" }], async () => {
      throw new Error("db closed");
    });
    await expect(pending.commit()).rejects.toThrow("db closed");
    expect(pending.status).toBe("failed");
    expect(isPendingDelete("tasks", "t1")).toBe(false);
  });

  it("画面が隠れたら(pagehide)、待っている削除を全部書き切る", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    deferDelete([{ table: "tasks", id: "a" }], first);
    deferDelete([{ table: "notes", id: "b" }], second);

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("アプリを切り替えた時(visibilitychange → hidden)も書き切る。見えている間は待つ", async () => {
    const commit = vi.fn(async () => {});
    deferDelete([{ table: "tasks", id: "a" }], commit);

    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).not.toHaveBeenCalled();

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("元に戻したものは、画面が隠れても消さない", async () => {
    const commit = vi.fn(async () => {});
    deferDelete([{ table: "tasks", id: "a" }], commit).undo();
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it("隠す・戻すたびに知らせる(一覧が描き直せるように)。集合は毎回作り直す", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingDeletes(listener);
    const before = getPendingDeletes();
    const pending = deferDelete([{ table: "tasks", id: "a" }], vi.fn());
    const during = getPendingDeletes();
    pending.undo();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(during).not.toBe(before);
    expect(during.has("tasks:a")).toBe(true);
    expect(getPendingDeletes().has("tasks:a")).toBe(false);
  });
});

describe("隠している行を除いた一覧(withoutPendingDeletes)", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: undefined }];

  it("何も隠していなければ同じ配列を返す(依存配列に入れても描き直しが増えない)", () => {
    expect(withoutPendingDeletes("tasks", rows)).toBe(rows);
  });

  it("別のテーブルの行を隠していても、この一覧はそのまま", () => {
    deferDelete([{ table: "notes", id: "a" }], vi.fn());
    expect(withoutPendingDeletes("tasks", rows)).toBe(rows);
  });

  it("隠している行だけ除く(id の無い行は残す)", () => {
    deferDelete([{ table: "tasks", id: "a" }], vi.fn());
    expect(withoutPendingDeletes("tasks", rows)).toEqual([{ id: "b" }, { id: undefined }]);
  });
});

describe("待っている間にアプリが閉じられた時の控え", () => {
  const KEY = scopedKey("lifeHubDeferredDeletes");
  const journal = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as { kind: string; id: string }[];

  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("種類と id を渡した削除は、待っている間だけ localStorage に控える", async () => {
    const pending = deferDelete([{ table: "notes", id: "n1" }], async () => {}, { kind: "note", id: "n1" });
    expect(journal()).toMatchObject([{ kind: "note", id: "n1" }]);
    await pending.commit();
    expect(journal()).toEqual([]);
  });

  it("元に戻したら控えも消す", () => {
    deferDelete([{ table: "notes", id: "n1" }], vi.fn(), { kind: "note", id: "n1" }).undo();
    expect(journal()).toEqual([]);
  });

  it("種類を渡さない削除(テストや一時的なもの)は控えない", () => {
    deferDelete([{ table: "notes", id: "n1" }], vi.fn());
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("いま待っている削除は、replay しても消さない(まだ元に戻せるため)", async () => {
    const commit = vi.fn();
    const remove = vi.fn();
    deferDelete([{ table: "notes", id: "n1" }], commit, { kind: "note", id: "n1" });
    expect(hasInterruptedDeletes()).toBe(false);
    await replayInterruptedDeletes({ note: remove });
    expect(remove).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("次に開いた時: 控えの行は最初から隠し、replay で消し切って控えを捨てる", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { token: "old-1", kind: "task", id: "p", rows: [{ table: "tasks", id: "p" }, { table: "tasks", id: "child" }] },
        { token: "old-2", kind: "unknown-kind", id: "x", rows: [{ table: "things", id: "x" }] },
      ]),
    );
    // 開き直した時と同じく、モジュールを読み込み直す。
    vi.resetModules();
    const fresh = await import("./deferredDelete");
    expect(fresh.isPendingDelete("tasks", "p")).toBe(true);
    expect(fresh.isPendingDelete("tasks", "child")).toBe(true);
    expect(fresh.hasInterruptedDeletes()).toBe(true);

    const removeTask = vi.fn(async () => {});
    await fresh.replayInterruptedDeletes({ task: removeTask });
    expect(removeTask).toHaveBeenCalledTimes(1);
    expect(removeTask).toHaveBeenCalledWith("p");
    // 知らない種類(古い版の控えなど)は、消さずに控えだけ捨てる。
    expect(journal()).toEqual([]);
    expect(fresh.hasInterruptedDeletes()).toBe(false);

    await vi.advanceTimersByTimeAsync(COMMITTED_UNHIDE_DELAY_MS);
    expect(fresh.isPendingDelete("tasks", "p")).toBe(false);
    expect(fresh.isPendingDelete("things", "x")).toBe(false);
  });

  it("控えが壊れていても読み込みで落ちない", async () => {
    localStorage.setItem(KEY, "{not json");
    vi.resetModules();
    const fresh = await import("./deferredDelete");
    expect(fresh.hasInterruptedDeletes()).toBe(false);
    await expect(fresh.replayInterruptedDeletes({})).resolves.toBeUndefined();
  });
});
