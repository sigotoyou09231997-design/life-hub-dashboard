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

  it("近い順の行と今月の合計。7日以内の行は is-soon(残りの日数を琥珀の字で出す)", () => {
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
    expect(first.className).toContain("is-soon");
    expect(first.textContent).toContain("明日");
    const second = screen.getByRole("link", { name: /Netflix/ });
    expect(second.className).not.toContain("is-soon");
    expect(second.textContent).toContain("あと8日");
    expect(screen.getByText("¥1,620")).toBeTruthy();
  });

  it("同じ日の請求が2件あっても、どちらの行にも残りの日数を出す(まとめの見出しは出さない)。印は頭文字の丸1つ", () => {
    render(
      <MemoryRouter>
        <HomeSubscriptions
          rows={[
            { id: "a", title: "家賃", amount: 78000, next: "2026-11-27", days: 1, soon: true, tab: "fixed" },
            { id: "b", title: "ChatGPT", amount: 3000, next: "2026-11-27", days: 1, soon: true, tab: "subs" },
          ]}
          thisMonthCharge={81000}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /家賃/ }).textContent).toContain("明日");
    expect(screen.getByRole("link", { name: /ChatGPT/ }).textContent).toContain("明日");
    expect(screen.queryByText(/に2件/)).toBeNull();
    expect(document.querySelector(".lh-concern__dot")).toBeNull();
    expect(document.querySelectorAll(".lh-subs__initial")).toHaveLength(2);
  });
});
