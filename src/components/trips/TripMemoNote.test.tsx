/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TripMemoNote } from "./TripMemoNote";

/** jsdom は配置を計算しない。3行の枠(60px)に対して、中身の高さを決めて測らせる。 */
function layoutText(contentHeight: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => contentHeight });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 60 });
}

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

describe("旅行のメモ", () => {
  it("3行に収まるメモは全部出し、「続きを読む」は出さない", () => {
    layoutText(40);
    render(<TripMemoNote memo="集合は東京駅 6:30" />);
    expect(screen.getByText("集合は東京駅 6:30")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("長いメモは3行で畳み、「続きを読む」で全部出す。「閉じる」で畳み直す", async () => {
    layoutText(200);
    const user = userEvent.setup();
    const memo = "1行目\n2行目\n3行目\n4行目\n5行目";
    render(<TripMemoNote memo={memo} />);
    const text = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === memo);
    expect(text.classList.contains("line-clamp-3")).toBe(true);

    await user.click(screen.getByRole("button", { name: "続きを読む" }));
    expect(text.classList.contains("line-clamp-3")).toBe(false);
    expect(screen.getByRole("button", { name: "閉じる" }).getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(text.classList.contains("line-clamp-3")).toBe(true);
    expect(screen.getByRole("button", { name: "続きを読む" }).getAttribute("aria-expanded")).toBe("false");
  });
});
