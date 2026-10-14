/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TripRouteForm } from "./TripRouteForm";

const mocks = vi.hoisted(() => ({
  follows: [] as [unknown, unknown][],
  note: null as string | null,
}));

vi.mock("../../db/schema", () => ({
  db: { tripRoutePlaces: { add: async () => "new-row", update: async () => 1 } },
}));

// ルートを直した時に日程も直す処理(src/lib/tripRouteLinks.ts)は別のテストで見る。ここでは、直す前と後を渡して呼ぶことだけ見る。
vi.mock("../../lib/tripRouteLinks", () => ({
  followScheduleAfterRouteEdit: async (before: unknown, after: unknown) => {
    mocks.follows.push([before, after]);
    return mocks.note;
  },
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

afterEach(() => {
  mocks.follows = [];
  mocks.note = null;
  cleanup();
});

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

describe("ルートの場所を直したら、元の日程も直す(2026-10-14、要望「日程とルートが連動してほしい」)", () => {
  const initial = { id: "p1", tripId: "t1", name: "霊山寺", address: "霊山寺", sortOrder: 1, date: "2026-09-19", visited: false, createdAt: 1 };

  function renderEdit(onSaved: (note?: string) => void) {
    render(<TripRouteForm tripId="t1" initial={initial} nextSortOrder={2} dayList={["2026-09-19", "2026-09-20"]} onSaved={onSaved} onCancel={() => {}} />);
  }

  it("保存したあと、直す前と直した後を渡して日程を追いかけさせる。直したら、その知らせを渡す", async () => {
    mocks.note = "日程の「霊山寺」も一緒に直しました(場所)";
    const onSaved = vi.fn();
    renderEdit(onSaved);
    fireEvent.change(screen.getByLabelText(/^住所・場所/), { target: { value: "霊山寺 徳島県鳴門市" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("日程の「霊山寺」も一緒に直しました(場所)"));
    expect(mocks.follows).toHaveLength(1);
    expect(mocks.follows[0][0]).toBe(initial);
    expect(mocks.follows[0][1]).toMatchObject({ id: "p1", name: "霊山寺", address: "霊山寺 徳島県鳴門市", date: "2026-09-19" });
  });

  it("日程を直さなかった時は、いつもどおり(知らせなし)。新しい場所を足す時は、追いかける元が無いので呼ばない", async () => {
    const onSaved = vi.fn();
    renderEdit(onSaved);
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith();

    cleanup();
    mocks.follows = [];
    const onAdded = vi.fn();
    render(<TripRouteForm tripId="t1" nextSortOrder={1} dayList={["2026-09-19"]} onSaved={onAdded} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^場所の名前/), { target: { value: "金閣寺" } });
    fireEvent.change(screen.getByLabelText(/^住所・場所/), { target: { value: "京都市北区金閣寺町1" } });
    fireEvent.click(screen.getByRole("button", { name: /追加|保存/ }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(mocks.follows).toEqual([]);
  });
});
