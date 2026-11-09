// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AiNewsPage from "./AiNewsPage";

const items = [
  { title: "Claude の新しいモデル", url: "https://ex.com/1", source: "ITmedia AI+", sourceId: "itmedia", lang: "ja", official: false, publishedAt: new Date().toISOString() },
  { title: "New model from OpenAI", url: "https://ex.com/2", source: "OpenAI", sourceId: "openai", lang: "en", official: true, publishedAt: new Date().toISOString() },
];

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("AIの最新情報ページ", () => {
  it("記事をカードで出し、日本語・公式で絞り込める", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items }) })));
    render(<MemoryRouter><AiNewsPage /></MemoryRouter>);
    expect(await screen.findByText("Claude の新しいモデル")).toBeTruthy();
    expect(screen.getByText("New model from OpenAI")).toBeTruthy();
    expect(screen.getByRole("link", { name: /New model from OpenAI/ }).getAttribute("href")).toBe("https://ex.com/2");

    fireEvent.click(screen.getByRole("tab", { name: "日本語" }));
    expect(screen.queryByText("New model from OpenAI")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "公式の発表" }));
    expect(screen.queryByText("Claude の新しいモデル")).toBeNull();
    expect(screen.getByText("New model from OpenAI")).toBeTruthy();
  });

  it("取れなかった時は、前に覚えた記事を出して知らせる", async () => {
    window.localStorage.setItem("lifeHubAiNews:v1", JSON.stringify({ at: 0, items }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })));
    render(<MemoryRouter><AiNewsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("前に取れた記事"));
    expect(screen.getByText("Claude の新しいモデル")).toBeTruthy();
  });
});
