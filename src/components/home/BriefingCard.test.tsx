/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SyncedEmail } from "../../types";
import type { ReplyWaitingItem } from "../../lib/replyWaiting";
import { BriefingCard, type BriefingGmail } from "./BriefingCard";

afterEach(cleanup);

const connected: BriefingGmail = { connected: true, importantUnread: 2, total: 5 };

function waitingItem(days: number): ReplyWaitingItem {
  return { email: { id: `m-${days}` } as SyncedEmail, sentAt: 0, waitingDays: days };
}

function renderCard(props: Partial<Parameters<typeof BriefingCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BriefingCard eventCount={2} nextEvent={{ title: "歯医者", time: "10:00" }} gmail={connected} waiting={[]} {...props} />
    </MemoryRouter>,
  );
}

function tile(name: RegExp) {
  return screen.getByRole("link", { name });
}

describe("ホームの「今日のまとめ」", () => {
  it("今日の予定・重要な未読・返信待ちを1枚に並べ、それぞれの画面へ行ける", () => {
    renderCard({ waiting: [waitingItem(6), waitingItem(3)] });
    const events = tile(/今日の予定/);
    expect(events.getAttribute("href")).toBe("/schedule?view=today");
    expect(within(events).getByText("次は 10:00 歯医者")).toBeTruthy();

    const important = tile(/重要な未読/);
    expect(important.getAttribute("href")).toBe("/gmail");
    expect(within(important).getByText("未処理 5件")).toBeTruthy();

    const waiting = tile(/返信待ち/);
    expect(within(waiting).getByText("いちばん長くて6日")).toBeTruthy();
    expect(waiting.className).toContain("is-alert");
  });

  it("Gmailを連携していない時は、メールの2つを出さない", () => {
    renderCard({ gmail: { connected: false, importantUnread: 0, total: 0 } });
    expect(tile(/今日の予定/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /重要な未読/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /返信待ち/ })).toBeNull();
  });

  it("今日の予定が全部終わった日・無い日は、そう書く", () => {
    renderCard({ nextEvent: undefined });
    expect(within(tile(/今日の予定/)).getByText("今日の分は終わりました")).toBeTruthy();
    cleanup();
    renderCard({ eventCount: 0, nextEvent: undefined });
    expect(within(tile(/今日の予定/)).getByText("予定はありません")).toBeTruthy();
  });

  it("返信待ちが無ければ強調しない", () => {
    renderCard({ gmail: { connected: true, importantUnread: 0, total: 0 } });
    expect(tile(/返信待ち/).className).not.toContain("is-alert");
    expect(tile(/重要な未読/).className).not.toContain("is-alert");
  });
});
