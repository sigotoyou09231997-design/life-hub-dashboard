/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CalendarEvent } from "../../types";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  others: [] as { userId: string; dbName: string; label: string; email: string | null }[],
  added: [] as CalendarEvent[],
  updated: [] as CalendarEvent[],
  applied: [] as { label: string; linkId: string; title: string; event: CalendarEvent }[],
  removed: [] as { label: string; linkId: string }[],
  /** 相手のアカウントに既に入っている「同じ予定」。linkId をキーにする。 */
  linked: {} as Record<string, CalendarEvent | undefined>,
}));

vi.mock("../../db/schema", () => ({
  db: {
    calendarEvents: {
      add: async (row: CalendarEvent) => {
        mocks.added.push(row);
        return "new-row";
      },
      update: async (_id: string, row: CalendarEvent) => {
        mocks.updated.push(row);
        return 1;
      },
    },
  },
}));

// 複製先の一覧と実際の書き込みだけ差し替える。どの予定名で何件足すかを決める
// 素の関数(planAccountEvents など)は本物のまま動かす。
vi.mock("../../lib/crossAccountEvents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/crossAccountEvents")>()),
  listOtherAccounts: () => mocks.others,
  findLinkedEvent: async (_account: unknown, linkId: string) => mocks.linked[linkId] ?? null,
  applyEventToAccount: async (account: { label: string }, event: CalendarEvent, linkId: string, title: string) => {
    mocks.applied.push({ label: account.label, linkId, title, event });
  },
  removeEventFromAccount: async (account: { label: string }, linkId: string) => {
    mocks.removed.push({ label: account.label, linkId });
  },
}));

// 元のメールの欄は自分のテスト(SourceMailLink.test.tsx)で見る。ここではDBを引かせない。
vi.mock("./SourceMailLink", () => ({ SourceMailLink: () => null }));

import { EventForm } from "./EventForm";

const existingEvent: CalendarEvent = {
  id: "event-1",
  title: "面接",
  date: "2026-09-01",
  allDay: true,
  category: "other",
  createdAt: 1_000,
};

const work = { userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" };

function renderForm(initial?: CalendarEvent) {
  return render(
    <ToastProvider>
      <EventForm initial={initial} defaultDate="2026-09-01" onSaved={() => {}} onCancel={() => {}} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.others = [];
  mocks.added = [];
  mocks.updated = [];
  mocks.applied = [];
  mocks.removed = [];
  mocks.linked = {};
});

afterEach(cleanup);

describe("ほかのアカウントにも入れる欄", () => {
  it("アカウントが1つだけなら出さない", () => {
    renderForm();
    expect(screen.queryByText("ほかのアカウントにも入れる")).toBeNull();
  });

  it("2つ以上あれば、新規作成で出る", () => {
    mocks.others = [{ userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" }];
    renderForm();
    expect(screen.getByText("ほかのアカウントにも入れる")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /仕事用/ })).toBeTruthy();
  });

  it("編集画面でも出る(作る時に入れ忘れた予定を後から入れられるように)", () => {
    mocks.others = [{ userId: "work", dbName: "life-hub-work", label: "仕事用", email: "work@example.com" }];
    renderForm(existingEvent);
    expect(screen.getByRole("switch", { name: /仕事用/ })).toBeTruthy();
    // 相手側がどうなるのか(連動する・外すと取り下げる)を、押す前に伝える。
    expect(screen.getByText(/一緒に直ります/)).toBeTruthy();
  });

  it("編集で保存し直しただけでは、相手のアカウントに何もしない", async () => {
    mocks.others = [work];
    const user = userEvent.setup();
    renderForm(existingEvent);

    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(mocks.updated).toHaveLength(1);
    expect(mocks.applied).toEqual([]);
    expect(mocks.removed).toEqual([]);
  });

  it("編集画面でチェックを入れて保存すると、相手のアカウントに反映する", async () => {
    mocks.others = [work];
    const user = userEvent.setup();
    renderForm(existingEvent);

    await user.click(screen.getByRole("switch", { name: /仕事用/ }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0].title).toBe("面接");
    // 印を持たせておかないと、次に直した時に相手側のどれが同じ予定か分からなくなる。
    expect(mocks.applied[0].linkId).toEqual(expect.any(String));
    expect(mocks.updated[0].linkId).toBe(mocks.applied[0].linkId);
  });

  it("そのアカウントでの予定名だけ書き換えて入れられる", async () => {
    mocks.others = [work];
    const user = userEvent.setup();
    renderForm(existingEvent);

    await user.click(screen.getByRole("switch", { name: /仕事用/ }));
    const perAccountTitle = screen.getByLabelText("このアカウントでの予定名");
    await user.clear(perAccountTitle);
    await user.type(perAccountTitle, "○○社 面接");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    // こちらの予定名はそのまま、相手側だけ書き換えた名前で入る。
    expect(mocks.updated[0].title).toBe("面接");
    expect(mocks.applied[0].title).toBe("○○社 面接");
  });
});

describe("入れた先のアカウントとの連動", () => {
  const linkedEvent: CalendarEvent = { ...existingEvent, linkId: "link-1" };

  it("既に入っているアカウントは、開いた時点でスイッチが入っていて名前も出る", async () => {
    mocks.others = [work];
    mocks.linked["link-1"] = { ...existingEvent, id: "work-row", title: "○○社 面接" };
    renderForm(linkedEvent);

    // 相手側を見に行くのは非同期なので、反映を待つ。
    expect(await screen.findByDisplayValue("○○社 面接")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /仕事用/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("そのまま保存すると、相手側は増えずに同じ印で直る", async () => {
    // 行き来して編集するたびに相手のスケジュールへ積み上がっていた不具合の再発防止。
    mocks.others = [work];
    mocks.linked["link-1"] = { ...existingEvent, id: "work-row", title: "○○社 面接" };
    const user = userEvent.setup();
    renderForm(linkedEvent);
    await screen.findByDisplayValue("○○社 面接");

    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(mocks.applied).toEqual([
      { label: "仕事用", linkId: "link-1", title: "○○社 面接", event: expect.objectContaining({ linkId: "link-1" }) },
    ]);
    expect(mocks.removed).toEqual([]);
  });

  it("チェックを外して保存すると、そのアカウントから取り下げる", async () => {
    mocks.others = [work];
    mocks.linked["link-1"] = { ...existingEvent, id: "work-row", title: "○○社 面接" };
    const user = userEvent.setup();
    renderForm(linkedEvent);
    await screen.findByDisplayValue("○○社 面接");

    await user.click(screen.getByRole("switch", { name: /仕事用/ }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(mocks.applied).toEqual([]);
    expect(mocks.removed).toEqual([{ label: "仕事用", linkId: "link-1" }]);
  });
});

describe("編集の保存", () => {
  it("既存の予定は更新する(新しく足さない)", async () => {
    const user = userEvent.setup();
    renderForm(existingEvent);
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated).toHaveLength(1);
    expect(mocks.added).toEqual([]);
  });

  it("更新先のidが無い予定は、保存せずに止める", async () => {
    // ここで下の「追加」に落ちると、直したつもりの予定が増えていく。
    const user = userEvent.setup();
    const { id: _dropped, ...withoutId } = existingEvent;
    renderForm(withoutId as CalendarEvent);
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.added).toEqual([]);
    expect(mocks.updated).toEqual([]);
    expect(screen.getByText(/更新先が見つかりませんでした/)).toBeTruthy();
  });
});

describe("印がまだ無い予定", () => {
  it("同じ予定を何度編集しても、印が変わらない(相手側に増え続けない)", async () => {
    // 毎回新しい印を作っていた頃は、編集のたびに相手側へ新しい予定が足されていた。
    mocks.others = [work];
    const user = userEvent.setup();

    const { unmount } = renderForm(existingEvent);
    await user.click(screen.getByRole("switch", { name: /仕事用/ }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    unmount();

    renderForm(existingEvent);
    await user.click(screen.getByRole("switch", { name: /仕事用/ }));
    await user.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(mocks.applied).toHaveLength(2);
    expect(mocks.applied[0].linkId).toBe(mocks.applied[1].linkId);
    // 印は予定自身のidを使うので、保存し直しても揺れない。
    expect(mocks.applied[0].linkId).toBe("event-1");
  });
});

describe("日付(開始日・終了日)", () => {
  /** 開いているカレンダーの、その月の日を押す。前後の月のはみ出し分(薄い文字)は
   * 同じ数字を名乗るので、その月の日だけに絞る。 */
  async function pickDay(user: ReturnType<typeof userEvent.setup>, day: string) {
    const cells = screen
      .getAllByRole("button", { name: day })
      .filter((cell) => !cell.querySelector("span")?.className.includes("text-slate-300"));
    expect(cells).toHaveLength(1);
    await user.click(cells[0]);
  }

  it("終了日は空のまま出て、そのまま保存すれば今までどおり1日で終わる予定になる", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole("button", { name: "日付の終了日" }).textContent).toContain("同じ日に終わる");

    await user.type(screen.getByLabelText("タイトル"), "歯医者");
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added).toHaveLength(1);
    expect(mocks.added[0].date).toBe("2026-09-01");
    expect(mocks.added[0].endDate).toBeUndefined();
  });

  it("終了日を選ぶと、その日までまたがる予定として保存される", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("タイトル"), "宿泊先");
    await user.click(screen.getByRole("button", { name: "日付の終了日" }));
    await pickDay(user, "3");
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0].date).toBe("2026-09-01");
    expect(mocks.added[0].endDate).toBe("2026-09-03");
  });

  it("終了日に開始日と同じ日を選んでも、またがる予定にはしない", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("タイトル"), "歯医者");
    await user.click(screen.getByRole("button", { name: "日付の終了日" }));
    await pickDay(user, "1");
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0].endDate).toBeUndefined();
  });

  it("開始日を動かすと、終了日も同じ日数ぶん一緒に動く", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("タイトル"), "宿泊先");
    // 9/1〜9/3 の3日間にしてから、開始日だけ9/10へ動かす。
    await user.click(screen.getByRole("button", { name: "日付の終了日" }));
    await pickDay(user, "3");
    await user.click(screen.getByRole("button", { name: "日付の開始日" }));
    await pickDay(user, "10");
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0].date).toBe("2026-09-10");
    expect(mocks.added[0].endDate).toBe("2026-09-12");
  });

  it("またがる予定を開き直すと、終了日が入ったまま出る", () => {
    renderForm({ ...existingEvent, date: "2026-09-01", endDate: "2026-09-03" });
    expect(screen.getByRole("button", { name: "日付の終了日" }).textContent).toContain("9/3");
    expect(screen.getByText(/3日間/)).toBeTruthy();
  });
});

describe("時刻の入れ方(開始を入れると終了が付いてくる)", () => {
  const startInput = () => screen.getByLabelText("開始時刻") as HTMLInputElement;
  const endInput = () => screen.getByLabelText("終了時刻") as HTMLInputElement;

  it("開始を入れると、空の終了に1時間後が入る(あとから直せる)", () => {
    renderForm();
    fireEvent.change(startInput(), { target: { value: "10:00" } });
    expect(endInput().value).toBe("11:00");

    fireEvent.change(endInput(), { target: { value: "10:45" } });
    expect(endInput().value).toBe("10:45");
  });

  it("こちらで入れた終了は、開始を直すとついてくる", () => {
    renderForm();
    fireEvent.change(startInput(), { target: { value: "10:00" } });
    fireEvent.change(startInput(), { target: { value: "14:30" } });
    expect(endInput().value).toBe("15:30");
  });

  it("手で入れた終了は、開始を直しても動かさない", () => {
    renderForm();
    fireEvent.change(startInput(), { target: { value: "10:00" } });
    fireEvent.change(endInput(), { target: { value: "12:00" } });
    fireEvent.change(startInput(), { target: { value: "10:30" } });
    expect(endInput().value).toBe("12:00");
  });

  it("編集で開いた予定の終了は、開始を直しても動かさない", () => {
    renderForm({ ...existingEvent, allDay: false, startTime: "10:00", endTime: "12:00" });
    fireEvent.change(startInput(), { target: { value: "09:00" } });
    expect(endInput().value).toBe("12:00");
  });

  it("カレンダーの週表示で時刻を押して開くと、その開始と1時間後の終了が入っていて、開始を直せば終了もついてくる", () => {
    render(
      <ToastProvider>
        <EventForm defaultDate="2026-09-01" defaultStartTime="14:30" onSaved={() => {}} onCancel={() => {}} />
      </ToastProvider>,
    );
    expect(startInput().value).toBe("14:30");
    expect(endInput().value).toBe("15:30");
    fireEvent.change(startInput(), { target: { value: "16:00" } });
    expect(endInput().value).toBe("17:00");
  });

  it("編集で開いた予定には、渡された開始時刻を使わない", () => {
    render(
      <ToastProvider>
        <EventForm
          initial={{ ...existingEvent, allDay: false, startTime: "10:00", endTime: "12:00" }}
          defaultDate="2026-09-01"
          defaultStartTime="14:30"
          onSaved={() => {}}
          onCancel={() => {}}
        />
      </ToastProvider>,
    );
    expect(startInput().value).toBe("10:00");
    expect(endInput().value).toBe("12:00");
  });

  it("1時間後が日付をまたぐ時は、終了を空のままにする", () => {
    renderForm();
    fireEvent.change(startInput(), { target: { value: "23:30" } });
    expect(endInput().value).toBe("");
  });

  it("開始の早押しで開始と終了が入り、そのまま保存される", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("タイトル"), "歯医者");
    await user.click(screen.getByRole("button", { name: "19:00" }));

    expect(startInput().value).toBe("19:00");
    expect(endInput().value).toBe("20:00");
    expect(screen.getByRole("button", { name: "19:00" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.added[0]).toMatchObject({ startTime: "19:00", endTime: "20:00", allDay: false });
  });

  it("長さの早押しは、開始が無いうちは押せない", () => {
    renderForm();
    for (const name of ["30分", "1時間", "2時間"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("長さを押すと終了が開始+長さになり、そのあと開始を動かしても長さを保つ", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "9:00" }));
    await user.click(screen.getByRole("button", { name: "2時間" }));
    expect(endInput().value).toBe("11:00");
    expect(screen.getByRole("button", { name: "2時間" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "12:00" }));
    expect(endInput().value).toBe("14:00");

    await user.click(screen.getByRole("button", { name: "30分" }));
    expect(endInput().value).toBe("12:30");
  });

  it("日付をまたぐ長さは押せない", () => {
    renderForm();
    fireEvent.change(startInput(), { target: { value: "22:30" } });
    expect((screen.getByRole("button", { name: "30分" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "1時間" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "2時間" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("カテゴリはプルダウンにしない・通知の欄は無い(2026-10-21 に画面外の通知をやめた)", () => {
  it("カテゴリはボタンで選べ、通知の欄は出さない", async () => {
    const user = userEvent.setup();
    renderForm();
    // iPhone のシートの中でプルダウンの選択肢が離れて出るので、この画面には1つも置かない。
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "通知しない" })).toBeNull();

    await user.type(screen.getByLabelText("タイトル"), "会議");
    await user.click(screen.getByRole("button", { name: "仕事" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0]).toMatchObject({ category: "work" });
    expect(mocks.added[0].notifyMinutesBefore).toBeUndefined();
  });

  it("前に通知を入れていた予定を直しても、その値は消さない", async () => {
    const user = userEvent.setup();
    renderForm({ ...existingEvent, allDay: false, startTime: "10:00", notifyMinutesBefore: 15, category: "important" });
    expect(screen.getByRole("button", { name: "重要" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(mocks.updated[0].notifyMinutesBefore).toBe(15);
  });
});

describe("タイトルに書いた日時", () => {
  beforeEach(() => {
    // 「明日」が何日かを決めるため、今日を 2026-10-12(月) に止める。タイマーは本物のまま。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12, 9, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("「明日19時 歯医者」で提案が出て、押すと日付・開始・終了が入り、タイトルは残りだけになる", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("タイトル"), "明日19時 歯医者");

    await user.click(screen.getByRole("button", { name: "10/13(火) 19:00 で入れる" }));

    expect((screen.getByLabelText("タイトル") as HTMLInputElement).value).toBe("歯医者");
    expect((screen.getByLabelText("開始時刻") as HTMLInputElement).value).toBe("19:00");
    expect((screen.getByLabelText("終了時刻") as HTMLInputElement).value).toBe("20:00");
    // 入れ終わったら、提案はもう出さない。
    expect(screen.queryByRole("button", { name: /で入れる/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "予定を追加" }));
    expect(mocks.added[0]).toMatchObject({
      title: "歯医者",
      date: "2026-10-13",
      startTime: "19:00",
      endTime: "20:00",
    });
  });

  it("押さなければ何も変えない(勝手に入れない)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("タイトル"), "明日19時 歯医者");
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0]).toMatchObject({ title: "明日19時 歯医者", date: "2026-09-01" });
    expect(mocks.added[0].startTime).toBeUndefined();
  });

  it("終わりまで書いてあれば、その終了を入れる", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("タイトル"), "来週の火曜 19時〜21時 飲み会");
    await user.click(screen.getByRole("button", { name: "10/20(火) 19:00〜21:00 で入れる" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0]).toMatchObject({
      title: "飲み会",
      date: "2026-10-20",
      startTime: "19:00",
      endTime: "21:00",
    });
  });

  it("終日にしていても、時刻つきの提案を押すと時刻のある予定に戻す", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "終日" }));
    await user.type(screen.getByLabelText("タイトル"), "明日19時 歯医者");
    await user.click(screen.getByRole("button", { name: "10/13(火) 19:00 で入れる" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0]).toMatchObject({ allDay: false, startTime: "19:00" });
  });

  it("日付だけの提案は、時刻と終日の設定に触らない", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "終日" }));
    await user.type(screen.getByLabelText("タイトル"), "10/20 健康診断");
    await user.click(screen.getByRole("button", { name: "10/20(火) で入れる" }));
    await user.click(screen.getByRole("button", { name: "予定を追加" }));

    expect(mocks.added[0]).toMatchObject({ title: "健康診断", date: "2026-10-20", allDay: true });
  });

  it("名前まで日時だった時は、タイトルを空にして打てるようにする", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("タイトル"), "明日19時");
    await user.click(screen.getByRole("button", { name: "10/13(火) 19:00 で入れる" }));

    const titleInput = screen.getByLabelText("タイトル") as HTMLInputElement;
    expect(titleInput.value).toBe("");
    expect(document.activeElement).toBe(titleInput);
  });

  it("編集で開いた予定は、タイトルを書き換えるまで提案を出さない", () => {
    renderForm({ ...existingEvent, title: "3時のおやつ" });
    expect(screen.queryByRole("button", { name: /で入れる/ })).toBeNull();
  });
});
