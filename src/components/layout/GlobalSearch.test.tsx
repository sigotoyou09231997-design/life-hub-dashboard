/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  trips: [] as Record<string, unknown>[],
  emails: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

/** Dexie の表のうち、まとめて検索が使う所だけ(全件・idでまとめて引く)。 */
function table(rows: () => Record<string, unknown>[]) {
  return {
    toArray: async () => rows(),
    bulkGet: async (ids: string[]) => ids.map((id) => rows().find((row) => row.id === id)),
  };
}

vi.mock("../../db/schema", () => ({
  db: {
    eventPeople: table(() => []),
    calendarEvents: table(() => mocks.events),
    tasks: table(() => []),
    notes: table(() => []),
    trips: table(() => mocks.trips),
    tripSchedule: table(() => []),
    syncedEmails: table(() => mocks.emails),
  },
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さないので、問い合わせを
// 1回実行するだけの最小版に差し替える(EventScanForm.test.tsx と同じ)。
vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((next) => {
          if (active) setValue(next);
        });
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});

import { GlobalSearch, usePaletteShortcut } from "./GlobalSearch";
import { RECENT_STORAGE_KEY } from "../../lib/recentItems";

function CurrentLocation() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPalette(path = "/") {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalSearch open onClose={onClose} />
      <CurrentLocation />
    </MemoryRouter>,
  );
  return { onClose };
}

const optionLabels = () => screen.getAllByRole("option").map((option) => option.textContent ?? "");
const selectedOption = () => screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true");

beforeEach(() => {
  mocks.trips = [
    { id: "trip1", name: "夏の京都", destination: "京都", startDate: "2026-09-01", endDate: "2026-09-03", status: "planning", createdAt: 1 },
  ];
  mocks.emails = [
    { id: "m1", accountId: "a1", gmailMessageId: "g1", threadId: "t1", from: "予約係", subject: "ご予約の確認", snippet: "", receivedAt: 1, status: "unprocessed", createdAt: 1 },
  ];
  mocks.events = [];
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("まとめて検索(何も打っていない時)", () => {
  it("よく使う操作と、この端末で最近見たものを出す", async () => {
    localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify([
        { kind: "email", id: "m1", at: 3 },
        { kind: "trip", id: "deleted-trip", at: 2 },
        { kind: "trip", id: "trip1", at: 1 },
      ]),
    );
    renderPalette();

    const actions = screen.getByRole("group", { name: "よく使う操作" });
    for (const label of ["支出を追加", "予定を追加", "タスクを追加", "メモを書く", "サブスクを見る"]) {
      expect(within(actions).getByRole("option", { name: new RegExp(label) })).toBeTruthy();
    }

    const recent = await screen.findByRole("group", { name: "最近見たもの" });
    const rows = within(recent).getAllByRole("option");
    // 消えた旅行(引けなかったもの)は出さず、残っているものは新しい順。
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("ご予約の確認"), expect.stringContaining("夏の京都")]);
    expect(rows[1].getAttribute("href")).toBe("/trips/trip1");
  });

  it("まだ何も見ていなければ、その旨を出す(保存できない端末でも同じ)", async () => {
    renderPalette();
    expect(await screen.findByText(/まだありません/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "最近見たもの" })).toBeNull();
  });

  it("↑↓で選ぶ行が動き、Enter でその行き先へ飛んで閉じる", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();
    const input = screen.getByRole("combobox", { name: "まとめて検索" });

    // 開いた直後は先頭が選ばれている。
    expect(selectedOption()?.textContent).toContain("支出を追加");
    expect(input.getAttribute("aria-activedescendant")).toBe(selectedOption()?.id);

    await user.keyboard("{ArrowDown}");
    expect(selectedOption()?.textContent).toContain("予定を追加");
    await user.keyboard("{ArrowDown}");
    expect(selectedOption()?.textContent).toContain("タスクを追加");
    await user.keyboard("{ArrowUp}");
    expect(selectedOption()?.textContent).toContain("予定を追加");
    expect(input.getAttribute("aria-activedescendant")).toBe(selectedOption()?.id);

    await user.keyboard("{Enter}");
    expect(screen.getByTestId("location").textContent).toBe("/schedule?new=event");
    expect(onClose).toHaveBeenCalled();
  });

  it("先頭で↑を押すと、いちばん下へ回る", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.keyboard("{ArrowUp}");
    const options = screen.getAllByRole("option");
    expect(selectedOption()).toBe(options[options.length - 1]);
  });

  it("Esc で閉じる", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("まとめて検索(打った時)", () => {
  it("「支出」と打つと、支出を追加がいちばん上に出て、Enter でフォームの印付きで開く", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole("combobox", { name: "まとめて検索" }), "支出");

    expect(optionLabels()[0]).toContain("支出を追加");
    expect(screen.getByRole("group", { name: "操作" })).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("location").textContent).toBe("/records/expense?new=expense");
  });

  it("操作とデータの当たりを、通しで↑↓できる", async () => {
    mocks.events = [{ id: "e1", title: "メモ帳を買う", date: "2026-10-20", createdAt: 1 }];
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole("combobox", { name: "まとめて検索" }), "メモ");

    const eventGroup = await screen.findByRole("group", { name: "予定" });
    const eventRow = within(eventGroup).getByRole("option");
    const all = screen.getAllByRole("option");
    // 操作(メモを書く・メモ・リストを開く)の後ろに予定の当たりが続く。
    expect(all[0].textContent).toContain("メモを書く");
    expect(all[all.length - 1]).toBe(eventRow);

    await user.keyboard("{ArrowUp}");
    expect(selectedOption()).toBe(eventRow);
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("location").textContent).toBe("/schedule?view=list");
    // 開いた当たりは「最近見たもの」に残る(予定は自分の画面を持たないので、ここでしか残せない)。
    const stored = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]") as { kind: string; id: string }[];
    expect(stored[0]).toMatchObject({ kind: "event", id: "e1" });
    // 行き先の画面も残るが、開いた予定の下に入る(後から先頭を奪わない)。
    expect(stored[1]).toMatchObject({ kind: "page", id: "/schedule" });
  });

  it("操作にもデータにも当たらなければ「見つかりませんでした」", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole("combobox", { name: "まとめて検索" }), "存在しない言葉");
    expect(await screen.findByText("見つかりませんでした")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("最近見たものを残す所", () => {
  it("旅行の詳細を開いたら、その旅行を残す", async () => {
    renderPalette("/trips/trip1");
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]") as { kind: string; id: string }[];
      expect(stored[0]).toMatchObject({ kind: "trip", id: "trip1" });
    });
  });

  it("いま開いている旅行は、最近見たものに出さない", async () => {
    localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify([
        { kind: "trip", id: "trip1", at: 2 },
        { kind: "email", id: "m1", at: 1 },
      ]),
    );
    renderPalette("/trips/trip1");
    const recent = await screen.findByRole("group", { name: "最近見たもの" });
    expect(within(recent).getAllByRole("option").map((row) => row.textContent)).toEqual([expect.stringContaining("ご予約の確認")]);
  });
});

function ShortcutHarness() {
  const [open, setOpen] = useState(false);
  usePaletteShortcut(open, setOpen);
  return (
    <>
      <p data-testid="state">{open ? "開いている" : "閉じている"}</p>
      <input aria-label="ほかの入力欄" />
      <button type="button">ほかのボタン</button>
    </>
  );
}

describe("⌘K / Ctrl+K", () => {
  it("⌘K でも Ctrl+K でも開き、もう一度押すと閉じる", async () => {
    const user = userEvent.setup();
    render(<ShortcutHarness />);
    const state = () => screen.getByTestId("state").textContent;

    await user.keyboard("{Meta>}k{/Meta}");
    expect(state()).toBe("開いている");
    await user.keyboard("{Meta>}k{/Meta}");
    expect(state()).toBe("閉じている");
    // この Mac は Command と Control を入れ替えているので、Control でも同じ。
    await user.keyboard("{Control>}k{/Control}");
    expect(state()).toBe("開いている");
  });

  it("ほかの入力欄で打っている最中は横取りしない", async () => {
    const user = userEvent.setup();
    render(<ShortcutHarness />);
    await user.click(screen.getByRole("textbox", { name: "ほかの入力欄" }));
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByTestId("state").textContent).toBe("閉じている");

    await user.click(screen.getByRole("button", { name: "ほかのボタン" }));
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByTestId("state").textContent).toBe("開いている");
  });

  it("ほかのシートが開いている間は出さない", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ShortcutHarness />
        <div role="dialog" aria-modal="true" aria-label="支出を追加" />
      </>,
    );
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByTestId("state").textContent).toBe("閉じている");
  });
});
