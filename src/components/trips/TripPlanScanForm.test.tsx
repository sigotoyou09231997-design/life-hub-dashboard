/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Trip } from "../../types";

const mocks = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  notices: [] as string[],
  extractError: null as Error | null,
  existingTripSchedule: [] as Record<string, unknown>[],
  saved: { tripSchedule: [] as unknown[], tripExpenses: [] as unknown[], updated: [] as { id: string; patch: unknown }[], deleted: [] as string[] },
  deletedPhotosFor: [] as string[],
  sent: [] as Record<string, unknown>[],
  // 専用GPTから届いた旅程(受信箱)と、送信コードの状態。
  inbox: [] as unknown[],
  sendCodeState: { kind: "unavailable" } as unknown,
  deletedInbox: [] as string[],
  createdCodes: 0,
  revokedCodes: 0,
}));

vi.mock("../../db/schema", () => ({
  db: {
    tripSchedule: {
      add: async (row: unknown) => void mocks.saved.tripSchedule.push(row),
      update: async (id: string, patch: unknown) => void mocks.saved.updated.push({ id, patch }),
      delete: async (id: string) => void mocks.saved.deleted.push(id),
      where: () => ({ equals: () => ({ toArray: async () => mocks.existingTripSchedule }) }),
    },
    tripExpenses: { add: async (row: unknown) => void mocks.saved.tripExpenses.push(row) },
  },
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さない。ここで見たいのは
// 画面の組み立てなので、問い合わせ関数を1回実行するだけの最小版に差し替える
// (src/components/gmail/MailPlanImport.test.tsx と同じ)。
// 予定を消す時は、その予定に貼った写真も片付ける(写真は別のテーブル)。ここでは誰の分を片付けたかだけ見る。
vi.mock("../../lib/attachments", async () => {
  const actual = await vi.importActual<typeof import("../../lib/attachments")>("../../lib/attachments");
  return { ...actual, deleteAttachmentsFor: async (_ownerType: string, ownerId: string) => void mocks.deletedPhotosFor.push(ownerId) };
});

vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useLiveQuery: (querier: () => unknown, deps: unknown[] = []) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((next) => {
          if (active) setValue(next);
        });
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
      return value;
    },
  };
});

vi.mock("../../lib/tripPlanScan", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tripPlanScan")>("../../lib/tripPlanScan");
  return {
    ...actual,
    scanTripPlan: async (input: Record<string, unknown>) => {
      mocks.sent.push(input);
      if (mocks.extractError) throw mocks.extractError;
      return { items: mocks.items, notices: mocks.notices };
    },
  };
});

// 受信箱と送信コードは Supabase を直接読み書きするので、ここでは差し替える(画面の組み立てだけを見る)。
vi.mock("../../lib/chatgptInbox", async () => {
  const actual = await vi.importActual<typeof import("../../lib/chatgptInbox")>("../../lib/chatgptInbox");
  return {
    ...actual,
    loadInbox: async () => mocks.inbox,
    deleteInboxEntry: async (id: string) => void mocks.deletedInbox.push(id),
    loadSendCodeState: async () => mocks.sendCodeState,
    createSendCode: async () => {
      mocks.createdCodes++;
      return "LH-NEW1-NEW2-NEW3-NEW4-NEW5";
    },
    revokeSendCode: async () => void mocks.revokedCodes++,
  };
});

import { TripPlanScanForm } from "./TripPlanScanForm";

const trip = { id: "trip-1", name: "函館旅行", startDate: "2026-09-12", endDate: "2026-09-14" } as Trip;

function renderForm(onSaved = () => {}) {
  return render(<TripPlanScanForm tripId="trip-1" trip={trip} onSaved={onSaved} onCancel={() => {}} />);
}

/** 文章を貼って読み取らせるところまで。 */
async function readFromText(user: ReturnType<typeof userEvent.setup>, text = "9/12 10:00 羽田発") {
  await user.type(screen.getByPlaceholderText(/羽田発/), text);
  await user.click(screen.getByRole("button", { name: "読み取る" }));
}

beforeEach(() => {
  mocks.items = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport", amount: 12540 }];
  mocks.notices = [];
  mocks.extractError = null;
  mocks.existingTripSchedule = [];
  mocks.saved = { tripSchedule: [], tripExpenses: [], updated: [], deleted: [] };
  mocks.deletedPhotosFor = [];
  mocks.sent = [];
  mocks.inbox = [];
  mocks.sendCodeState = { kind: "unavailable" };
  mocks.deletedInbox = [];
  mocks.createdCodes = 0;
  mocks.revokedCodes = 0;
});

afterEach(cleanup);

describe("写真・文章から日程を読み取る画面", () => {
  it("写真と文章の入り口を出す(読み取るのは、どちらかを入れてから)", () => {
    // 旅行の日程タブから常に開ける画面。ここが実行時に落ちると日程が触れなくなる。
    renderForm();
    expect(screen.getByRole("button", { name: /写真を選ぶ/ })).toBeTruthy();
    expect(screen.getByPlaceholderText(/羽田発/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "読み取る" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("読み取った内容を、そのまま保存せず確認させる", async () => {
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByDisplayValue("羽田→福岡")).toBeTruthy();
    expect(mocks.saved.tripSchedule).toEqual([]);
    // 「2日目」を実際の日付に直せるよう、旅行の期間を渡している。
    expect(mocks.sent[0]).toMatchObject({ tripStart: "2026-09-12", tripEnd: "2026-09-14" });
  });

  it("確認した分を、この旅行の日程に入れる", async () => {
    const saved = vi.fn();
    const user = userEvent.setup();
    renderForm(saved);
    await readFromText(user);
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tripSchedule).toEqual([
      expect.objectContaining({ tripId: "trip-1", date: "2026-09-12", startTime: "08:20", title: "羽田→福岡" }),
    ]);
    // 金額が読み取れた分は、既定で旅行の費用にも積む(外せる)。
    expect(mocks.saved.tripExpenses).toEqual([expect.objectContaining({ tripId: "trip-1", amount: 12540 })]);
    expect(saved).toHaveBeenCalledWith("日程に1件、費用に1件入れました");
  });

  it("費用を外せば、日程だけ入る", async () => {
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    await user.click(screen.getByRole("switch", { name: "費用にも入れる" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tripSchedule).toHaveLength(1);
    expect(mocks.saved.tripExpenses).toEqual([]);
  });

  it("同じ内容が既に日程にあれば入れない", async () => {
    // 同じしおりを2回読ませても、日程表が二重にならないようにする。
    mocks.existingTripSchedule = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("すでに登録されています")).toBeTruthy();
    expect((screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("同じ日に似た予定があれば、外した状態で並べて断りを出す", async () => {
    // しおりを読み直すたびに同じ予定が積み上がるのを、押す前に止める。
    // 完全一致と違って入れられる(重ねたい時もある)ので、チェックだけ外しておく。
    mocks.existingTripSchedule = [{ date: "2026-09-19", title: "鎌倉散歩" }];
    mocks.items = [{ date: "2026-09-19", title: "お迎え・買い出し・鎌倉散歩", type: "sightseeing" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText(/同じ日に「鎌倉散歩」があります/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // 重ねて入れたい時は、自分でチェックすれば入る。
    await user.click(screen.getByRole("checkbox", { name: "お迎え・買い出し・鎌倉散歩を入れる" }));
    await user.click(screen.getByRole("button", { name: "1件を入れる" }));
    expect(mocks.saved.tripSchedule).toHaveLength(1);
  });

  describe("いまの日程との違いを分けて出す", () => {
    // 旅行の計画の文章を丸ごと貼り直した時に、足りない予定と違う予定だけが目に入るようにする。
    // 全部を1列に並べていた頃は、7日ぶん(約120件)の「すでに登録されています」の中に数件が埋もれた。

    it("まだ入っていない・内容が違う・入っている に分けて数を出す", async () => {
      mocks.existingTripSchedule = [
        { id: "a", date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" },
        { id: "b", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" },
      ];
      mocks.items = [
        { date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" },
        { date: "2026-09-12", startTime: "11:00", title: "レンタカー受取", type: "other" },
        { date: "2026-09-13", startTime: "09:00", title: "函館朝市", type: "sightseeing" },
      ];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText("まだ入っていない予定：1件")).toBeTruthy();
      expect(screen.getByText("内容が違う予定：1件")).toBeTruthy();
      expect(screen.getByText("入っている予定（同じ内容）：1件")).toBeTruthy();
      const fresh = screen.getByRole("region", { name: "まだ入っていない予定" });
      expect(fresh.textContent).toContain("まだ入っていない予定（1件）");
      expect(screen.getByDisplayValue("函館朝市").closest("section")).toBe(fresh);
      const changed = screen.getByRole("region", { name: "内容が違う予定" });
      expect(changed.textContent).toContain("「レンタカー受取」を、この内容に更新します");
      // 同じ内容のものは畳んだ中にある(開けば見られる)。
      const same = screen.getByText("入っている予定（同じ内容）1件を見る").closest("details")!;
      expect(same.textContent).toContain("すでに登録されています");
      expect(fresh.textContent).not.toContain("すでに登録されています");
      await user.click(screen.getByRole("button", { name: "1件を入れて1件を更新する" }));
      expect(mocks.saved.tripSchedule).toEqual([expect.objectContaining({ title: "函館朝市" })]);
      expect(mocks.saved.updated).toEqual([{ id: "b", patch: { startTime: "11:00" } }]);
    });

    it("足りない予定も違う予定も無ければ、そう知らせる", async () => {
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" }];
      mocks.items = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText(/足りない予定も、内容が違う予定もありません/)).toBeTruthy();
      expect(screen.queryByRole("region", { name: "まだ入っていない予定" })).toBeNull();
    });

    it("書き方が少し違うだけの同じ予定は、入っている予定に回し、似た予定の断りを出さない", async () => {
      // 読み直すたびにAIの題名の書き方が変わる(「屋島観光」と「屋島」)。変わる所が無ければ同じ予定。
      mocks.existingTripSchedule = [{ id: "y", date: "2026-09-13", startTime: "16:40", title: "屋島観光", type: "sightseeing" }];
      mocks.items = [{ date: "2026-09-13", startTime: "16:40", title: "屋島", type: "sightseeing" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText("入っている予定（同じ内容）：1件")).toBeTruthy();
      expect(screen.getByText("まだ入っていない予定：0件")).toBeTruthy();
      expect(screen.queryByText(/同じ日に「屋島観光」があります/)).toBeNull();
      expect((screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("地域つきに直した場所は、元の計画文を貼り直しても書き戻さない", async () => {
      mocks.existingTripSchedule = [
        { id: "r", date: "2026-09-12", startTime: "13:30", title: "霊山寺", type: "sightseeing", location: "霊山寺 徳島県鳴門市大麻町" },
        { id: "m", date: "2026-09-12", startTime: "12:10", title: "高松→大麻比古神社", type: "transport", location: "ニコニコレンタカー高松県庁前店 香川県高松市" },
      ];
      mocks.items = [
        { date: "2026-09-12", startTime: "13:30", title: "霊山寺", type: "sightseeing", location: "霊山寺" },
        { date: "2026-09-12", startTime: "12:10", title: "高松→大麻比古神社", type: "transport", location: "高松市内" },
      ];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText("内容が違う予定：0件")).toBeTruthy();
      expect(screen.getByText("入っている予定（同じ内容）：2件")).toBeTruthy();
    });

    it("同じ時刻に似た名前の予定があっても、場所が違えば「まだ入っていない予定」として選んだ状態で出す", async () => {
      // 本人の旅行(7日・123件)の規模で試した時、足した「松山城山ロープウェイ」が既存の「松山城」の
      // 更新として既定で選ばれ、保存すると松山城が書き換わっていた。
      mocks.existingTripSchedule = [
        { id: "c", date: "2026-09-13", startTime: "15:00", endTime: "16:00", title: "松山城", type: "sightseeing", location: "松山城", memo: "外観中心" },
      ];
      mocks.items = [
        { date: "2026-09-13", startTime: "15:00", endTime: "16:00", title: "松山城", type: "sightseeing", location: "松山城", memo: "外観中心" },
        { date: "2026-09-13", startTime: "15:00", title: "松山城山ロープウェイ", type: "sightseeing", location: "松山城山ロープウェイ" },
      ];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText("まだ入っていない予定：1件")).toBeTruthy();
      expect(screen.getByText("内容が違う予定：0件")).toBeTruthy();
      expect(screen.queryByText(/同じ日に「松山城」があります/)).toBeNull();
      await user.click(screen.getByRole("button", { name: "1件を入れる" }));
      expect(mocks.saved.tripSchedule).toEqual([expect.objectContaining({ title: "松山城山ロープウェイ", startTime: "15:00" })]);
      expect((mocks.saved.tripSchedule[0] as { memo?: string }).memo).toBeUndefined();
      expect(mocks.saved.updated).toEqual([]);
    });

    it("組み直した計画: 順番が入れ替わった予定は時刻の更新に、文章に無い古い区間は選べば消せる", async () => {
      mocks.existingTripSchedule = [
        { id: "o", date: "2026-09-12", startTime: "13:15", endTime: "13:30", title: "大麻比古神社", type: "sightseeing" },
        { id: "r", date: "2026-09-12", startTime: "13:30", endTime: "13:45", title: "霊山寺", type: "sightseeing" },
        { id: "leg", date: "2026-09-12", startTime: "13:45", endTime: "14:25", title: "霊山寺→鳴門観光汽船", type: "transport" },
        { id: "other-day", date: "2026-09-13", startTime: "09:00", title: "函館朝市", type: "sightseeing" },
      ];
      mocks.items = [
        { date: "2026-09-12", startTime: "13:15", endTime: "13:30", title: "霊山寺参拝", type: "sightseeing" },
        { date: "2026-09-12", startTime: "13:45", endTime: "14:00", title: "大麻比古神社参拝", type: "sightseeing" },
        { date: "2026-09-12", startTime: "14:00", endTime: "14:25", title: "アクアエディ乗り場へ移動", type: "transport" },
      ];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText("まだ入っていない予定：1件")).toBeTruthy();
      expect(screen.getByText("内容が違う予定：2件")).toBeTruthy();
      expect(screen.getByText("文章に無い予定：1件")).toBeTruthy();
      // 文章が扱っていない日(9/13)の予定は、文章に無い予定に出さない。
      const unmentioned = screen.getByRole("region", { name: "文章に無い予定" });
      expect(unmentioned.textContent).toContain("霊山寺→鳴門観光汽船");
      expect(unmentioned.textContent).not.toContain("函館朝市");
      // 既定では消さない。
      expect(screen.getByRole("button", { name: "1件を入れて2件を更新する" })).toBeTruthy();
      await user.click(screen.getByRole("checkbox", { name: "霊山寺→鳴門観光汽船を消す" }));
      await user.click(screen.getByRole("button", { name: "1件を入れて2件を更新し、1件を消す" }));
      expect(mocks.saved.deleted).toEqual(["leg"]);
      expect(mocks.saved.updated.map((u) => u.id).sort()).toEqual(["o", "r"]);
      expect(mocks.saved.tripSchedule).toEqual([expect.objectContaining({ title: "アクアエディ乗り場へ移動" })]);
    });

    it("「すべて選ぶ」で文章に無い予定をまとめて選び、消すだけでも押せる", async () => {
      mocks.existingTripSchedule = [
        { id: "a", date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" },
        { id: "b", date: "2026-09-12", startTime: "16:00", title: "古い予定1", type: "other" },
        { id: "c", date: "2026-09-12", startTime: "17:00", title: "古い予定2", type: "meal" },
      ];
      mocks.items = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      await user.click(screen.getByRole("button", { name: "すべて選ぶ" }));
      await user.click(screen.getByRole("button", { name: "2件を消す" }));
      expect(mocks.saved.deleted.sort()).toEqual(["b", "c"]);
      expect(mocks.deletedPhotosFor.sort()).toEqual(["b", "c"]);
    });

    it("まだ日程が1件も無い旅行では、比べた結果ではなく、これまでの説明を出す", async () => {
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.queryByText("いまの日程と比べました")).toBeNull();
      expect(screen.getByText(/読み取った内容です/)).toBeTruthy();
    });
  });

  describe("すでに入っている日程の更新", () => {
    // 計画の途中で、しおりの出発が変わった・場所が分かった時に、1件ずつ開いて打ち直さずに
    // 文章を貼り直して反映する。追加だけだった頃は、同じ予定は見送るしかなかった。

    it("同じ予定で時刻が変わっていれば、更新として前後を並べる", async () => {
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" }];
      mocks.items = [{ date: "2026-09-12", startTime: "11:00", title: "レンタカー受取", type: "other" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText(/「レンタカー受取」を、この内容に更新します/)).toBeTruthy();
      expect(screen.getByText(/開始: 10:00/)).toBeTruthy();
      // 確かな一致は既定で選んである。まだ保存はされていない。
      expect(screen.getByRole("button", { name: "1件を更新する" })).toBeTruthy();
      expect(mocks.saved.updated).toEqual([]);
    });

    it("更新を押すと、変わる項目だけを既存の日程に書く(追加はしない)", async () => {
      mocks.existingTripSchedule = [
        { id: "a", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", location: "土庄港", memo: "自分のメモ", type: "other" },
      ];
      mocks.items = [
        { date: "2026-09-12", startTime: "11:00", title: "レンタカー受取", location: "土庄港", memo: "AIのメモ", type: "other", amount: 8000 },
      ];
      const saved = vi.fn();
      const user = userEvent.setup();
      renderForm(saved);
      await readFromText(user);
      await user.click(screen.getByRole("button", { name: "1件を更新する" }));
      // 変わった時刻だけ。書いてあったメモは上書きしない。
      expect(mocks.saved.updated).toEqual([{ id: "a", patch: { startTime: "11:00" } }]);
      expect(mocks.saved.tripSchedule).toEqual([]);
      // 同じ予定の費用が二重にならないよう、更新では費用を積まない。
      expect(mocks.saved.tripExpenses).toEqual([]);
      expect(saved).toHaveBeenCalledWith("日程を1件更新しました");
    });

    it("追加と更新が混ざっていても、それぞれ入る", async () => {
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" }];
      mocks.items = [
        { date: "2026-09-12", startTime: "11:00", title: "レンタカー受取", type: "other" },
        { date: "2026-09-12", startTime: "13:00", title: "昼食", type: "meal" },
      ];
      const saved = vi.fn();
      const user = userEvent.setup();
      renderForm(saved);
      await readFromText(user);
      await user.click(screen.getByRole("button", { name: "1件を入れて1件を更新する" }));
      expect(mocks.saved.updated).toEqual([{ id: "a", patch: { startTime: "11:00" } }]);
      expect(mocks.saved.tripSchedule).toEqual([expect.objectContaining({ title: "昼食", startTime: "13:00" })]);
      expect(saved).toHaveBeenCalledWith("日程に1件入れ、日程を1件更新しました");
    });

    it("文章に無かった既存の日程は、触らない・消さない", async () => {
      mocks.existingTripSchedule = [
        { id: "a", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" },
        { id: "b", date: "2026-09-13", startTime: "09:00", title: "五稜郭", type: "sightseeing" },
      ];
      mocks.items = [{ date: "2026-09-12", startTime: "11:00", title: "レンタカー受取", type: "other" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      await user.click(screen.getByRole("button", { name: "1件を更新する" }));
      expect(mocks.saved.updated.map((entry) => entry.id)).toEqual(["a"]);
    });

    it("片方がもう片方を含むだけの一致は、既定では選ばず、選べば更新できる", async () => {
      // 別の予定かもしれないので、勝手には書き換えない。
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-13", title: "鎌倉散歩", type: "sightseeing" }];
      mocks.items = [{ date: "2026-09-13", title: "お迎え・買い出し・鎌倉散歩", location: "鎌倉", type: "sightseeing" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText(/同じ日に「鎌倉散歩」があります/)).toBeTruthy();
      expect((screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement).disabled).toBe(true);
      await user.click(screen.getByRole("checkbox", { name: "お迎え・買い出し・鎌倉散歩を入れる" }));
      await user.click(screen.getByRole("button", { name: "1件を更新する" }));
      expect(mocks.saved.updated).toEqual([
        { id: "a", patch: { title: "お迎え・買い出し・鎌倉散歩", location: "鎌倉" } },
      ]);
      expect(mocks.saved.tripSchedule).toEqual([]);
    });

    it("「別の予定として追加」に切り替えれば、更新せず新しく入れる", async () => {
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" }];
      mocks.items = [{ date: "2026-09-12", startTime: "11:00", title: "レンタカー受取", type: "other" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      await user.click(screen.getByRole("tab", { name: "別の予定として追加" }));
      await user.click(screen.getByRole("button", { name: "1件を入れる" }));
      expect(mocks.saved.updated).toEqual([]);
      expect(mocks.saved.tripSchedule).toEqual([expect.objectContaining({ startTime: "11:00", title: "レンタカー受取" })]);
    });

    it("日付・時刻・題名が完全に同じ日程の更新は、追加を選ばせない(二重になる)", async () => {
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" }];
      mocks.items = [{ date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", location: "土庄港", type: "other" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText(/場所: なし/)).toBeTruthy();
      expect(screen.queryByRole("tab", { name: "別の予定として追加" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "1件を更新する" }));
      expect(mocks.saved.updated).toEqual([{ id: "a", patch: { location: "土庄港" } }]);
      expect(mocks.saved.tripSchedule).toEqual([]);
    });

    it("2行が同じ日程を書き換えない(2行目は新しい予定になる)", async () => {
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-12", startTime: "12:00", title: "昼食", type: "meal" }];
      mocks.items = [
        { date: "2026-09-12", startTime: "12:00", title: "昼食", location: "函館駅前", type: "meal" },
        { date: "2026-09-12", startTime: "18:00", title: "昼食", location: "五稜郭", type: "meal" },
      ];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      await user.click(screen.getByRole("button", { name: "1件を入れて1件を更新する" }));
      expect(mocks.saved.updated).toEqual([{ id: "a", patch: { location: "函館駅前" } }]);
      expect(mocks.saved.tripSchedule).toEqual([expect.objectContaining({ startTime: "18:00", location: "五稜郭" })]);
    });

    it("更新する所が無い同じ予定は、これまでどおり「すでに登録されています」", async () => {
      mocks.existingTripSchedule = [{ id: "a", date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" }];
      mocks.items = [{ date: "2026-09-12", startTime: "10:00", title: "レンタカー受取", type: "other" }];
      const user = userEvent.setup();
      renderForm();
      await readFromText(user);
      expect(screen.getByText("すでに登録されています")).toBeTruthy();
      expect((screen.getByRole("button", { name: "0件を入れる" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it("しおり1枚ぶん(時刻の無い8日分)をまとめて入れる", async () => {
    // 時刻の書かれていない旅程表がいちばん多い形。日付だけで入れられること、
    // 1日に複数の予定が並んでも別々の行になることを固定する。
    mocks.items = [
      { date: "2026-09-19", title: "鎌倉散歩", location: "鎌倉", type: "sightseeing" },
      { date: "2026-09-20", title: "初心者船釣り", location: "腰越", type: "sightseeing" },
      { date: "2026-09-21", title: "海沿いドライブ", location: "葉山・三浦半島", type: "transport" },
      { date: "2026-09-22", title: "えのすい", location: "江の島", type: "sightseeing" },
      { date: "2026-09-22", title: "江の島灯籠", location: "江の島", type: "sightseeing" },
      { date: "2026-09-23", title: "トイ・ストーリー5", location: "辻堂", type: "other" },
      { date: "2026-09-24", title: "みなとみらい・中華街", location: "横浜", type: "sightseeing" },
      { date: "2026-09-25", title: "大涌谷・芦ノ湖・温泉", location: "箱根", type: "sightseeing" },
    ];
    const saved = vi.fn();
    const user = userEvent.setup();
    renderForm(saved);
    await readFromText(user);
    await user.click(screen.getByRole("button", { name: "8件を入れる" }));
    expect(mocks.saved.tripSchedule).toHaveLength(8);
    // 金額が読み取れていない分は、費用には積まない。
    expect(mocks.saved.tripExpenses).toEqual([]);
    expect(saved).toHaveBeenCalledWith("日程に8件入れました");
  });

  it("7日ぶんの旅程(80件)も、1件も落とさず並べて入れられる", async () => {
    // 2026-10-04: 7日ぶんの旅程を貼ったら先頭20件で切れて、後ろの日が黙って消えていた。
    // 画面は渡された件数をそのまま並べ、入れる時も全部入ること。
    mocks.items = Array.from({ length: 80 }, (_, i) => ({
      date: `2026-09-${String(12 + Math.floor(i / 12)).padStart(2, "0")}`,
      startTime: `${String(6 + (i % 12)).padStart(2, "0")}:00`,
      title: `予定${i + 1}`,
      type: "sightseeing",
    }));
    const saved = vi.fn();
    const user = userEvent.setup();
    renderForm(saved);
    await readFromText(user);
    await user.click(screen.getByRole("button", { name: "80件を入れる" }));
    expect(mocks.saved.tripSchedule).toHaveLength(80);
    expect(saved).toHaveBeenCalledWith("日程に80件入れました");
  });

  it("全部は読み取れていない時は、日程の上に断りを出す", async () => {
    // 抜けた日があることに気付かないまま、読み取れた分だけを信じて動かないように。
    mocks.notices = ["「■12/29(火)」から始まる部分が読み取れませんでした。その部分だけ貼り直して、もう一度お試しください"];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByRole("alert").textContent).toContain("「■12/29(火)」から始まる部分が読み取れませんでした");
    // 読めた分は捨てずに並べてある。
    expect(screen.getByDisplayValue("羽田→福岡")).toBeTruthy();
  });

  it("全部読めた時は、断りを出さない", async () => {
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("旅行の期間から外れた日付には印を出す", async () => {
    // 入れられるが日程表には出てこないので、気付けるようにする。
    mocks.items = [{ date: "2026-10-01", title: "五稜郭", type: "sightseeing" }];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText(/この旅行の期間の外です/)).toBeTruthy();
  });

  it("読み取れなかった時は、やり直せる", async () => {
    mocks.items = [];
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("日程になりそうな内容は見つかりませんでした")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("button", { name: "読み取る" })).toBeTruthy();
  });

  it("失敗した理由をそのまま出す", async () => {
    mocks.extractError = Object.assign(new Error("写真が大きすぎます"), { status: 400 });
    const user = userEvent.setup();
    renderForm();
    await readFromText(user);
    expect(screen.getByText("写真が大きすぎます")).toBeTruthy();
  });
});

describe("ChatGPTで旅程を作ってもらう入り口", () => {
  /** 本物のクリップボードの代わり。user-event が入れる代用品より後に差し込む。 */
  function stubClipboard(initial = "") {
    const clipboard = {
      text: initial,
      writeText: vi.fn(async (text: string) => {
        clipboard.text = text;
      }),
      readText: vi.fn(async () => clipboard.text),
    };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    return clipboard;
  }

  async function openGuide(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /ChatGPTで旅程を作ってもらう/ }));
  }

  it("閉じている間は条件の欄を出さず、これまでの入り口はそのまま使える", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /ChatGPTで旅程を作ってもらう/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "依頼文をコピー" })).toBeNull();
    expect(screen.getByPlaceholderText(/羽田発/)).toBeTruthy();
  });

  it("依頼文をコピーできる(旅行の条件と、入れた希望が入る)", async () => {
    const user = userEvent.setup();
    const clipboard = stubClipboard();
    renderForm();
    await openGuide(user);
    await user.type(screen.getByPlaceholderText("例: 小金井"), "羽田");
    await user.click(screen.getByRole("button", { name: "依頼文をコピー" }));
    expect(clipboard.text).toContain("・旅行名: 函館旅行");
    expect(clipboard.text).toContain("・出発地: 羽田");
    // 旅行の日数ぶんの見出しを、日付つきで並べさせる(3日)。
    expect(clipboard.text).toContain("次の3つを、この順で全部作る");
    expect(clipboard.text).toContain("■2026/9/12(");
    expect(screen.getByText(/コピーしました/)).toBeTruthy();
  });

  it("ChatGPTを別のタブで開く", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    renderForm();
    await openGuide(user);
    await user.click(screen.getByRole("button", { name: "ChatGPTを開く" }));
    expect(open).toHaveBeenCalledWith("https://chatgpt.com/", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("返事を貼ると文章の欄に入り、そのまま読み取りに渡せる", async () => {
    const reply = "■2026/9/12(土) 羽田→函館\n08:20 羽田空港 → 函館空港 (JAL)\n12:00 昼食 函館朝市";
    const user = userEvent.setup();
    stubClipboard(reply);
    renderForm();
    await openGuide(user);
    await user.click(screen.getByRole("button", { name: "返事を貼る" }));
    expect((screen.getByPlaceholderText(/羽田発/) as HTMLTextAreaElement).value).toBe(reply);
    await user.click(screen.getByRole("button", { name: "読み取る" }));
    // 読み取りは、写真・文章の取り込みと同じ(旅行の期間も渡す)。
    expect(mocks.sent[0]).toMatchObject({ text: reply, tripStart: "2026-09-12", tripEnd: "2026-09-14" });
  });

  it("すでに打ってある文章は消さずに、返事を足す", async () => {
    const user = userEvent.setup();
    stubClipboard("■2026/9/13(日) 函館観光");
    renderForm();
    await user.type(screen.getByPlaceholderText(/羽田発/), "9/12 10:00 羽田発");
    await openGuide(user);
    await user.click(screen.getByRole("button", { name: "返事を貼る" }));
    expect((screen.getByPlaceholderText(/羽田発/) as HTMLTextAreaElement).value).toBe("9/12 10:00 羽田発\n\n■2026/9/13(日) 函館観光");
  });

  it("依頼文のままコピーされている時は、貼らずに知らせる(依頼文を日程として読ませない)", async () => {
    const user = userEvent.setup();
    stubClipboard();
    renderForm();
    await openGuide(user);
    await user.click(screen.getByRole("button", { name: "依頼文をコピー" }));
    await user.click(screen.getByRole("button", { name: "返事を貼る" }));
    expect((screen.getByPlaceholderText(/羽田発/) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText(/いまコピーされているのは依頼文です/)).toBeTruthy();
  });

  it("クリップボードを読めない端末では、直接貼る案内を出す", async () => {
    const user = userEvent.setup();
    const clipboard = stubClipboard();
    clipboard.readText.mockRejectedValue(new Error("denied"));
    renderForm();
    await openGuide(user);
    await user.click(screen.getByRole("button", { name: "返事を貼る" }));
    expect(screen.getByText(/下の「文章」の欄に、返事を直接貼り付けてください/)).toBeTruthy();
  });
});

describe("専用GPTから届いた旅程(受信箱)", () => {
  const entry = {
    id: "inbox-1",
    tripName: "函館旅行",
    startDate: "2026-09-12",
    endDate: "2026-09-14",
    receivedAt: Date.parse("2026-09-01T03:04:00Z"),
    items: [
      { date: "2026-09-12", startTime: "08:20", title: "羽田→函館", type: "transport", endLocation: "函館空港" },
      { date: "2026-09-12", startTime: "12:00", title: "昼食 函館朝市", type: "meal" },
    ],
  };

  it("1件も届いていなければ、何も出さない", async () => {
    renderForm();
    // 読み込みが終わるのを待ってから、出ていないことを確かめる。
    await screen.findByRole("button", { name: "読み取る" });
    expect(screen.queryByText("ChatGPTから届いた旅程")).toBeNull();
  });

  it("届いた旅程を並べ、名前・期間・件数が分かる", async () => {
    mocks.inbox = [entry];
    renderForm();
    expect(await screen.findByText("ChatGPTから届いた旅程")).toBeTruthy();
    expect(screen.getByText("函館旅行")).toBeTruthy();
    expect(screen.getByText(/9\/12〜9\/14 ・ 2件/)).toBeTruthy();
  });

  it("読み込むと確認画面に並ぶ。この時点では日程に入らず、受信箱からも消えない", async () => {
    mocks.inbox = [entry];
    const user = userEvent.setup();
    renderForm();
    await user.click(await screen.findByRole("button", { name: "読み込む" }));
    expect(screen.getByDisplayValue("羽田→函館")).toBeTruthy();
    expect(screen.getByDisplayValue("昼食 函館朝市")).toBeTruthy();
    expect(mocks.saved.tripSchedule).toEqual([]);
    expect(mocks.deletedInbox).toEqual([]);
    // AIの読み取りは通らない(届いた時点で項目に分かれている)。
    expect(mocks.sent).toEqual([]);
  });

  it("確認して日程に入れたら、受信箱から消す", async () => {
    mocks.inbox = [entry];
    const user = userEvent.setup();
    renderForm();
    await user.click(await screen.findByRole("button", { name: "読み込む" }));
    await user.click(screen.getByRole("button", { name: "2件を入れる" }));
    expect(mocks.saved.tripSchedule).toEqual([
      expect.objectContaining({ tripId: "trip-1", date: "2026-09-12", startTime: "08:20", title: "羽田→函館" }),
      expect.objectContaining({ tripId: "trip-1", title: "昼食 函館朝市" }),
    ]);
    expect(mocks.deletedInbox).toEqual(["inbox-1"]);
  });

  it("入れずにキャンセルしたら、受信箱に残す", async () => {
    mocks.inbox = [entry];
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<TripPlanScanForm tripId="trip-1" trip={trip} onSaved={() => {}} onCancel={onCancel} />);
    await user.click(await screen.findByRole("button", { name: "読み込む" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalled();
    expect(mocks.deletedInbox).toEqual([]);
  });

  it("すでに入っている日程と同じ予定は、受信箱から読み込んでも二重に入れさせない", async () => {
    mocks.inbox = [entry];
    mocks.existingTripSchedule = [{ date: "2026-09-12", startTime: "08:20", title: "羽田→函館" }];
    const user = userEvent.setup();
    renderForm();
    await user.click(await screen.findByRole("button", { name: "読み込む" }));
    expect(screen.getByText("すでに登録されています")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1件を入れる" })).toBeTruthy();
  });

  it("要らない旅程は、受信箱から消せる", async () => {
    mocks.inbox = [entry];
    const user = userEvent.setup();
    renderForm();
    await user.click(await screen.findByRole("button", { name: /「函館旅行」を受信箱から消す/ }));
    expect(mocks.deletedInbox).toEqual(["inbox-1"]);
    expect(screen.queryByText("函館旅行")).toBeNull();
  });
});

describe("送信コード(専用GPTから直接送る)", () => {
  async function openGuide(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /ChatGPTで旅程を作ってもらう/ }));
  }

  it("ログインしていない・SQLを流す前は、この部分を出さない", async () => {
    const user = userEvent.setup();
    renderForm();
    await openGuide(user);
    // 他の部分(依頼文のコピー)は出ている。
    expect(screen.getByRole("button", { name: "依頼文をコピー" })).toBeTruthy();
    expect(screen.queryByText(/ChatGPTから直接送る/)).toBeNull();
  });

  it("コードが無ければ、作れる。作ると、コードが出てコピーできる", async () => {
    mocks.sendCodeState = { kind: "none" };
    const user = userEvent.setup();
    renderForm();
    await openGuide(user);
    await user.click(await screen.findByRole("button", { name: "送信コードを作る" }));
    expect(mocks.createdCodes).toBe(1);
    expect(await screen.findByText("LH-NEW1-NEW2-NEW3-NEW4-NEW5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "コードをコピー" })).toBeTruthy();
    // コードを知っている人は受信箱に置ける、という注意を出している。
    expect(screen.getByText(/他の人には見せないでください/)).toBeTruthy();
  });

  it("別の端末で作ったコードは表示できないので、作り直しを案内する", async () => {
    mocks.sendCodeState = { kind: "active", createdAt: "2026-10-06T00:00:00Z" };
    const user = userEvent.setup();
    renderForm();
    await openGuide(user);
    expect(await screen.findByText(/作った端末でしか表示できない/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "コードをコピー" })).toBeNull();
  });

  it("作り直す・無効にするは、確かめてから実行する(古いコードが使えなくなるため)", async () => {
    mocks.sendCodeState = { kind: "active", createdAt: "x", code: "LH-AAAA-BBBB-CCCC-DDDD-EEEE" };
    const user = userEvent.setup();
    renderForm();
    await openGuide(user);
    await user.click(await screen.findByRole("button", { name: "作り直す" }));
    // 押しただけでは作り直さない。
    expect(mocks.createdCodes).toBe(0);
    expect(screen.getByText(/今のコードはこの瞬間から使えなくなります/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "やめる" }));
    expect(mocks.createdCodes).toBe(0);

    await user.click(screen.getByRole("button", { name: "無効にする" }));
    expect(mocks.revokedCodes).toBe(0);
    // 確認の表示に切り替わるので、「無効にする」はその中の1つだけ。
    expect(screen.getByText(/専用GPTからは何も送れなくなります/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "無効にする" }));
    expect(mocks.revokedCodes).toBe(1);
    // 無効にしたあとは、もう一度作れる状態に戻る。
    expect(await screen.findByRole("button", { name: "送信コードを作る" })).toBeTruthy();
  });
});
