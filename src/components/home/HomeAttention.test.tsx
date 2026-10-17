/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Concern } from "../../lib/homeLayout";
import { buildConcerns } from "../../lib/homeLayout";
import { HomeAttention, LEAVE_MS } from "./HomeAttention";

vi.mock("../layout/AddChooser", () => ({ openQuickAdd: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderRows(concerns: Concern[]) {
  return render(
    <MemoryRouter>
      <HomeAttention concerns={concerns} />
    </MemoryRouter>,
  );
}

describe("ホームの「気になること」", () => {
  it("0件なら、カードを出さず1行の文だけ", () => {
    const { container } = renderRows([]);
    expect(screen.getByText("気になることはありません")).toBeTruthy();
    expect(container.querySelector(".warm-card")).toBeNull();
  });

  it("返信待ちがあれば赤い点の行になり、押すとそのメールへ。設定の未完は琥珀の点", () => {
    renderRows(
      buildConcerns({
        waiting: [{ emailId: "m1", name: "山田", waitingDays: 4 }],
        forecasts: [],
        overdueTasks: 0,
        reauthEmails: [],
        setupItems: [{ id: "homeAddress", label: "自宅の住所を入れる", to: "/settings" }],
      }),
    );
    const waiting = screen.getByRole("link", { name: /山田 からの返信を 4日待っています/ });
    expect(waiting.getAttribute("href")).toBe("/gmail/mail/m1");
    expect(waiting.querySelector(".lh-concern__dot.is-red")).toBeTruthy();
    const setup = screen.getByRole("link", { name: /自宅の住所を入れる/ });
    expect(setup.querySelector(".lh-concern__dot.is-amber")).toBeTruthy();
    // 今日のまとめのタイル(今日の予定・重要な未読)は、ここには無い。
    expect(screen.queryByText(/今日の予定/)).toBeNull();
    expect(screen.queryByText(/重要な未読/)).toBeNull();
  });

  it("解消した行は、少しのあいだ右へ流れてから消える", () => {
    vi.useFakeTimers();
    const rows = buildConcerns({ waiting: [], forecasts: [], overdueTasks: 2, reauthEmails: [], setupItems: [] });
    const { rerender } = renderRows(rows);
    expect(screen.getByText("期限を過ぎたタスクが 2件")).toBeTruthy();
    rerender(
      <MemoryRouter>
        <HomeAttention concerns={[]} />
      </MemoryRouter>,
    );
    const leaving = screen.getByText("期限を過ぎたタスクが 2件").closest(".lh-concern__row")!;
    expect(leaving.classList.contains("is-leaving")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(LEAVE_MS + 10);
    });
    expect(screen.queryByText("期限を過ぎたタスクが 2件")).toBeNull();
    expect(screen.getByText("気になることはありません")).toBeTruthy();
  });
});
