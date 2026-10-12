/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tabs } from "./Tabs";

afterEach(cleanup);

const OPTIONS = ["日程", "費用", "持ち物", "ルート", "日記", "書類"].map((label, i) => ({ value: `t${i}`, label }));

describe("Tabs", () => {
  it("6個でも2段に折り返さず、1段の横に流せる帯に並ぶ", () => {
    render(<Tabs options={OPTIONS} value="t0" onChange={() => {}} />);
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("flex");
    expect(list.className).not.toContain("grid-cols");
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });

  it("押したタブを選び、選んでいるものに印が付く", () => {
    const onChange = vi.fn();
    render(<Tabs options={OPTIONS} value="t2" onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "持ち物" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "書類" }));
    expect(onChange).toHaveBeenCalledWith("t5");
  });
});
