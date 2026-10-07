/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn() }));

vi.mock("../../lib/supabase", () => ({ auth: { oauth: { listGrants: mocks.list, revokeGrant: mocks.revoke } } }));

import { ConnectedApps } from "./ConnectedApps";

const grant = { client: { id: "client-1", name: "ChatGPT", uri: "", logo_uri: "" }, scopes: ["openid"], granted_at: "2026-10-07T00:00:00Z" };

beforeEach(() => {
  mocks.list.mockReset();
  mocks.revoke.mockReset();
});

afterEach(cleanup);

describe("接続しているアプリ", () => {
  it("1件も無ければ、何も出さない。読めない時も出さない", async () => {
    mocks.list.mockResolvedValue({ data: [], error: null });
    const { container } = render(<ConnectedApps />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
    cleanup();
    mocks.list.mockRejectedValue(new Error("oauth server disabled"));
    const failed = render(<ConnectedApps />);
    await Promise.resolve();
    expect(failed.container.textContent).toBe("");
  });

  it("接続しているアプリを並べる。外すには、確かめてから", async () => {
    mocks.list.mockResolvedValue({ data: [grant], error: null });
    mocks.revoke.mockResolvedValue({ data: null, error: null });
    render(<ConnectedApps />);
    expect(await screen.findByText("ChatGPT")).toBeTruthy();
    expect(screen.getByText(/2026\/10\/7に許可/)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "接続を外す" }));
    // 押しただけでは外さない。
    expect(mocks.revoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "やめる" }));
    expect(mocks.revoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "接続を外す" }));
    await user.click(screen.getByRole("button", { name: "外す" }));
    expect(mocks.revoke).toHaveBeenCalledWith({ clientId: "client-1" });
    expect(await screen.findByText(/接続を外しました/)).toBeTruthy();
    expect(screen.queryByText("ChatGPT")).toBeNull();
  });

  it("外せなかった時は、案内を出して、一覧に残す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.list.mockResolvedValue({ data: [grant], error: null });
    mocks.revoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<ConnectedApps />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "接続を外す" }));
    await user.click(screen.getByRole("button", { name: "外す" }));
    expect(await screen.findByText(/接続を外せませんでした/)).toBeTruthy();
    expect(screen.getByText("ChatGPT")).toBeTruthy();
  });
});
