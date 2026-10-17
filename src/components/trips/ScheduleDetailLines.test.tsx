/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduleDetailLines } from "./ScheduleDetailLines";

afterEach(cleanup);

describe("予定の詳細の表示(第6弾 D-3: 押せるものはアイコン、文は「詳細」で開く)", () => {
  it("住所は地図、電話はかける、URLは開くアイコンのボタンにする。営業時間は「詳細」を押した時だけ", async () => {
    const user = userEvent.setup();
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
    // 住所の全文と営業時間は畳んである。
    expect(screen.queryByText("営業 9:00〜16:30")).toBeNull();
    const more = screen.getByRole("button", { name: "詳細" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await user.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("営業 9:00〜16:30")).toBeTruthy();
    expect(screen.getByText("徳島県鳴門市")).toBeTruthy();
  });

  it("ハイフン無しで保存してある電話番号も、ハイフン付きで出す(かける番号はそのまま)", () => {
    render(<ScheduleDetailLines item={{ type: "sightseeing", phone: "0886870613" }} />);
    const link = screen.getByRole("link", { name: /088-687-0613/ });
    expect(link.getAttribute("href")).toBe("tel:0886870613");
    // 電話だけなら、開くものが無いので「詳細」は出さない。
    expect(screen.queryByRole("button", { name: "詳細" })).toBeNull();
  });

  it("宿泊の予定はチェックイン・チェックアウトを「詳細」の中に出す", async () => {
    const user = userEvent.setup();
    render(<ScheduleDetailLines item={{ type: "lodging", checkInTime: "15:00", checkOutTime: "10:00" }} />);
    await user.click(screen.getByRole("button", { name: "詳細" }));
    expect(screen.getByText("チェックイン 15:00 / チェックアウト 10:00")).toBeTruthy();
  });

  it("http(s) でない URL はリンクにしない(共有したしおりは外から読むため)", () => {
    const { container } = render(<ScheduleDetailLines item={{ type: "other", url: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("詳細が何も無ければ、何も出さない", () => {
    const { container } = render(<ScheduleDetailLines item={{ type: "other" }} />);
    expect(container.textContent).toBe("");
  });
});

describe("ScheduleDetailLines: 移動の目的地の住所(2026-10-15)", () => {
  it("移動なら、出発地の住所と目的地の住所を、それぞれ地図のボタンで出す(両方あれば「出発」「到着」を添える)", async () => {
    const user = userEvent.setup();
    render(<ScheduleDetailLines item={{ type: "transport", address: "東京都千代田区丸の内1-9-1", endAddress: "京都府京都市下京区" }} />);
    expect(screen.getByRole("link", { name: /出発 東京都千代田区丸の内1-9-1/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /到着 京都府京都市下京区/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "詳細" }));
    expect(screen.getByText("出発 東京都千代田区丸の内1-9-1")).toBeTruthy();
    expect(screen.getByText("到着 京都府京都市下京区")).toBeTruthy();
  });

  it("目的地の住所だけなら、そのまま出す。移動でない予定の目的地の住所は出さない", () => {
    const { rerender } = render(<ScheduleDetailLines item={{ type: "transport", endAddress: "京都府京都市下京区" }} />);
    expect(screen.getByRole("link", { name: "地図 京都府京都市下京区" })).toBeTruthy();
    rerender(<ScheduleDetailLines item={{ type: "sightseeing", endAddress: "京都府京都市下京区" }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
