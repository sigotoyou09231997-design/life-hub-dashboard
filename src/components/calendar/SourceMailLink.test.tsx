/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EventMailLink } from "../../types";

const mocks = vi.hoisted(() => ({
  link: null as EventMailLink | null,
  target: { kind: "app", to: "/gmail/mail/local-1" } as { kind: "app"; to: string } | { kind: "gmail"; href: string },
}));

vi.mock("../../lib/eventMailLink", () => ({
  findEventMailLink: async () => mocks.link,
  resolveMailLinkTarget: async () => mocks.target,
}));

import { SourceMailLink } from "./SourceMailLink";

const link: EventMailLink = {
  id: "link-1",
  eventId: "event-1",
  accountEmail: "me@example.com",
  gmailMessageId: "18f0a",
  subject: "面接日程のご案内",
  sender: "山田 <yamada@example.com>",
  createdAt: 1_000,
};

function renderLink() {
  return render(
    <MemoryRouter>
      <SourceMailLink eventId="event-1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.link = null;
  mocks.target = { kind: "app", to: "/gmail/mail/local-1" };
});

afterEach(() => cleanup());

describe("予定の編集画面の「元のメール」", () => {
  it("メールから作った予定では、件名と差出人と、アプリのメール画面へのリンクが出る", async () => {
    mocks.link = link;
    renderLink();
    const open = await screen.findByRole("link", { name: "元のメールを開く" });
    expect(open.getAttribute("href")).toBe("/gmail/mail/local-1");
    expect(screen.getByText("面接日程のご案内")).toBeTruthy();
    expect(screen.getByText("山田")).toBeTruthy();
  });

  it("この端末にメールが無い時は、Gmail本体を別のタブで開く", async () => {
    mocks.link = link;
    mocks.target = { kind: "gmail", href: "https://mail.google.com/mail/u/me%40example.com/#all/18f0a" };
    renderLink();
    const open = await screen.findByRole("link", { name: /Gmailで開く/ });
    expect(open.getAttribute("href")).toBe("https://mail.google.com/mail/u/me%40example.com/#all/18f0a");
    expect(open.getAttribute("target")).toBe("_blank");
  });

  it("つながりの無い予定(手入力で作った予定)には何も出ない", async () => {
    renderLink();
    // 問い合わせが済むのを待ってから、何も描かれていないことを見る。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("元のメール")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
