// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { USAGE_FEATURES, summarizeUsage, type UsageCountMap, type UsageSnapshot } from "../../lib/featureUsage";
import { UsageAlertCard } from "./UsageAlertCard";
import { UsageOverview } from "./UsageOverview";

afterEach(cleanup);

function counts(): UsageCountMap {
  const zero = Object.fromEntries(USAGE_FEATURES.map((feature) => [feature.id, { last30: 0, last90: 0, ever: 0 }]));
  return {
    ...zero,
    gmailRead: { last30: 149, last90: 149, ever: 149 },
    expense: { last30: 0, last90: 82, ever: 82 },
    event: { last30: 18, last90: 18, ever: 18 },
  };
}

function snapshot(): UsageSnapshot {
  return { scope: "user-1", date: "2026-09-13", source: "server", generatedAt: Date.now(), counts: counts() };
}

describe("UsageOverview", () => {
  it("よく使う機能・使われていない機能・一言コメントを描く", () => {
    const report = summarizeUsage(counts());
    render(<UsageOverview report={report} snapshot={snapshot()} failed={false} refreshing={false} onRefresh={() => {}} />);

    expect(screen.getByText("よく使う機能 TOP5")).toBeTruthy();
    expect(screen.getByText("使われていない機能")).toBeTruthy();
    expect(screen.getByText("最近ゼロ")).toBeTruthy();
    // 90日の合計は 149 + 82 + 18 = 249 件。支出は 82 / 249 = 32.9%。
    expect(screen.getByText("90日では32.9%使われていました")).toBeTruthy();
    expect(screen.getByText(/が「Gmailの既読」です。/)).toBeTruthy();
    expect(screen.getByText("まだ使っていない機能")).toBeTruthy();
  });

  it("集計に失敗したら、その旨と数え直しの案内を出す", () => {
    const onRefresh = vi.fn();
    render(<UsageOverview report={null} snapshot={null} failed refreshing={false} onRefresh={onRefresh} />);

    expect(screen.getByText(/集計できませんでした/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /数え直す/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("UsageAlertCard", () => {
  it("お知らせが無ければ何も描かない", () => {
    const { container } = render(
      <MemoryRouter>
        <UsageAlertCard alerts={[]} onDismiss={() => {}} />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("お知らせを出し、「今月は表示しない」で閉じられる", () => {
    const onDismiss = vi.fn();
    const report = summarizeUsage(counts());
    render(
      <MemoryRouter>
        <UsageAlertCard alerts={report.alerts} onDismiss={onDismiss} />
      </MemoryRouter>,
    );

    expect(screen.getByText("支出の記録、最近使われていません")).toBeTruthy();
    expect(screen.getByRole("link", { name: /ふりかえりで見る/ }).getAttribute("href")).toBe("/review");
    fireEvent.click(screen.getByRole("button", { name: "今月は表示しない" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
