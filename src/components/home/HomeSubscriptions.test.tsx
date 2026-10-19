/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomeSubscriptions } from "./HomeSubscriptions";

afterEach(cleanup);

describe("ホームの「次の請求」", () => {
  it("0件なら何も出さない", () => {
    const { container } = render(
      <MemoryRouter>
        <HomeSubscriptions rows={[]} thisMonthCharge={0} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });

  it("近い順の行と今月の合計。7日以内の行には琥珀の点", () => {
    render(
      <MemoryRouter>
        <HomeSubscriptions
          rows={[
            { id: "a", title: "iCloud", amount: 130, next: "2026-10-18", days: 1, soon: true, tab: "subs" },
            { id: "b", title: "Netflix", amount: 1490, next: "2026-10-25", days: 8, soon: false, tab: "subs" },
          ]}
          thisMonthCharge={1620}
        />
      </MemoryRouter>,
    );
    const first = screen.getByRole("link", { name: /iCloud/ });
    expect(first.querySelector(".lh-concern__dot.is-amber")).toBeTruthy();
    expect(first.textContent).toContain("明日");
    const second = screen.getByRole("link", { name: /Netflix/ });
    expect(second.querySelector(".lh-concern__dot.is-amber")).toBeNull();
    expect(second.textContent).toContain("あと8日");
    expect(screen.getByText("¥1,620")).toBeTruthy();
  });
});
