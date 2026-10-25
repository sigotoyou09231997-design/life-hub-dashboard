/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../db/schema", () => ({ db: { calendarEvents: { put: vi.fn(), delete: vi.fn(), toArray: async () => [] } } }));
vi.mock("../ui/ToastProvider", () => ({ useToast: () => vi.fn() }));

import { SoccerTeamsCard } from "./SoccerTeamsCard";
import { loadSoccerTeams } from "../../lib/soccerFixtures";

const teamsBody = { children: [{ standings: { entries: [{ team: { id: "359", displayName: "Arsenal" } }, { team: { id: "364", displayName: "Liverpool" } }] } }] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SoccerTeamsCard", () => {
  it("リーグを選ぶとチームが出て、選ぶと覚える。外すと消える", async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("/teams/") ? { events: [] } : teamsBody) }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SoccerTeamsCard />);
    expect(screen.getByText("未設定")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("リーグ"), "eng.1");
    await waitFor(() => expect(screen.getByRole("option", { name: "Arsenal" })).toBeTruthy());
    await user.selectOptions(screen.getByLabelText("チームを追加"), "359");

    expect(loadSoccerTeams().map((t) => t.name)).toEqual(["Arsenal"]);
    expect(screen.getByText("1 チーム")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Arsenalを外す" }));
    expect(loadSoccerTeams()).toEqual([]);
  });
});
