/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScheduleDetailLines } from "./ScheduleDetailLines";

afterEach(cleanup);

describe("予定の詳細の表示", () => {
  it("住所は地図、電話はかける、URLは開くリンクにする", () => {
    render(
      <ScheduleDetailLines
        item={{ type: "sightseeing", address: "徳島県鳴門市", phone: "088-687-0613", url: "https://www.uzusio.com/", openingHours: "9:00〜16:30" }}
      />,
    );
    expect(screen.getByRole("link", { name: /徳島県鳴門市/ }).getAttribute("href")).toContain("/maps/search/");
    expect(screen.getByRole("link", { name: /088-687-0613/ }).getAttribute("href")).toBe("tel:0886870613");
    const site = screen.getByRole("link", { name: /uzusio\.com/ });
    expect(site.getAttribute("href")).toBe("https://www.uzusio.com/");
    expect(site.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("営業 9:00〜16:30")).toBeTruthy();
  });

  it("ハイフン無しで保存してある電話番号も、ハイフン付きで出す(かける番号はそのまま)", () => {
    render(<ScheduleDetailLines item={{ type: "sightseeing", phone: "0886870613" }} />);
    const link = screen.getByRole("link", { name: /088-687-0613/ });
    expect(link.getAttribute("href")).toBe("tel:0886870613");
  });

  it("宿泊の予定はチェックイン・チェックアウトを出す", () => {
    render(<ScheduleDetailLines item={{ type: "lodging", checkInTime: "15:00", checkOutTime: "10:00" }} />);
    expect(screen.getByText("チェックイン 15:00 / チェックアウト 10:00")).toBeTruthy();
  });

  it("http(s) でない URL はリンクにしない(共有したしおりは外から読むため)", () => {
    render(<ScheduleDetailLines item={{ type: "other", url: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("詳細が何も無ければ、何も出さない", () => {
    const { container } = render(<ScheduleDetailLines item={{ type: "other" }} />);
    expect(container.textContent).toBe("");
  });
});
