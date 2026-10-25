/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../db/schema", () => ({ db: { calendarEvents: { put: vi.fn(), delete: vi.fn(), toArray: async () => [] } } }));
vi.mock("../ui/ToastProvider", () => ({ useToast: () => vi.fn() }));

import { SoccerTeamsCard } from "./SoccerTeamsCard";
import { loadSoccerTeams } from "../../lib/soccerFixtures";

const teamsBody = { children: [{ standings: { entries: [{ team: { id: "359", displayName: "Arsenal" } }, { team: { id: "364", displayName: "Liverpool" } }] } }] };

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.includes("kind=fixtures") ? { events: [] } : teamsBody),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SoccerTeamsCard", () => {
  it("リーグのチームを押して選び、もう一度押すか「外す」で外せる", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<SoccerTeamsCard />);
    expect(screen.getByText(/まだ選んでいません/)).toBeTruthy();

    const tile = await screen.findByRole("button", { name: "アーセナル" });
    expect(tile.getAttribute("aria-pressed")).toBe("false");
    await user.click(tile);

    expect(loadSoccerTeams().map((t) => t.name)).toEqual(["アーセナル"]);
    expect(screen.getByRole("button", { name: "アーセナル" }).getAttribute("aria-pressed")).toBe("true");
    // 選んだチームの欄に、リーグごとに並ぶ
    expect(screen.getByText("プレミアリーグ(イングランド)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "アーセナルを外す" }));
    expect(loadSoccerTeams()).toEqual([]);
    expect(screen.getByRole("button", { name: "アーセナル" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("リーグのタブを切り替えると、そのリーグのチーム一覧を読む(読んだリーグは読み直さない)", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<SoccerTeamsCard />);
    await screen.findByRole("button", { name: "アーセナル" });
    await user.click(screen.getByRole("tab", { name: "ラ・リーガ" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/soccer?kind=teams&value=esp.1"));
    await user.click(screen.getByRole("tab", { name: "プレミア" }));
    await screen.findByRole("button", { name: "アーセナル" });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("value=eng.1"))).toHaveLength(1);
  });

  it("一覧が取れなかった時は、読み直すボタンを出す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<SoccerTeamsCard />);
    expect(await screen.findByText(/チーム一覧を取れませんでした/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "もう一度読み込む" })).toBeTruthy();
  });
});
