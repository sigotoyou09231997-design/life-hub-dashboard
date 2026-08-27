/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TripRouteForm } from "./TripRouteForm";

vi.mock("../../db/schema", () => ({
  db: { tripRoutePlaces: { add: async () => "new-row", update: async () => 1 } },
}));

function renderForm(dayList: string[]) {
  render(
    <TripRouteForm
      tripId="t1"
      nextSortOrder={0}
      dayList={dayList}
      onSaved={() => {}}
      onCancel={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("「何日目に回るか」の置き方", () => {
  /** 面の左上に文字が貼り付いていたのは、この項目だけ素のdivで組まれていて、
   * 他の項目(メモなど)が持っている余白が付いていなかったため。 */
  it("メモと同じ「項目」として置く(見出しと余白を自前で持たない)", () => {
    renderForm(["2026-09-19", "2026-09-20", "2026-09-21"]);

    const label = screen.getByText("何日目に回るか", { selector: ".field__label" });
    expect(label.closest(".field")).toBeTruthy();
    // 「任意」の印も、他の項目と同じ出し方になっている。
    expect(label.closest(".field__head")?.querySelector(".field__optional")?.textContent).toBe("任意");
  });

  it("1日だけの旅行では、そもそも出さない", () => {
    renderForm(["2026-09-19"]);
    expect(screen.queryByText("何日目に回るか")).toBeNull();
  });
});
