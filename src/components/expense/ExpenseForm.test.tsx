/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "../../types";

const mocks = vi.hoisted(() => ({
  past: [] as Transaction[],
  added: [] as Transaction[],
  updated: [] as [string, Transaction][],
  tags: {} as Record<string, string>,
  savedTags: [] as [string, string][],
}));

vi.mock("../../db/schema", () => ({
  db: {
    transactions: {
      toArray: async () => mocks.past,
      add: async (row: Transaction) => {
        mocks.added.push(row);
        return "new-row";
      },
      update: async (id: string, row: Transaction) => {
        mocks.updated.push([id, row]);
        return 1;
      },
    },
    transactionProjectTags: { toArray: async () => [] },
  },
}));

// 案件タグの読み書きは別のテーブル。ここでは「何を書こうとしたか」だけ見る。
vi.mock("../../lib/projectTags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/projectTags")>()),
  loadProjectTag: async (id: string) => mocks.tags[id] ?? "",
  saveProjectTag: async (id: string, tag: string) => void mocks.savedTags.push([id, tag]),
}));

// useLiveQuery は本物のDexieテーブルを相手にしないと値を返さないので、問い合わせを
// 1回実行するだけの最小版に差し替える(SubscriptionTab.test.tsx と同じ)。
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

import { ExpenseForm } from "./ExpenseForm";

function past(category: string, over: Partial<Transaction> = {}): Transaction {
  return { type: "expense", amount: 300, category, date: "2026-10-01", isFixed: false, createdAt: 1, ...over };
}

/** 項目の見出し(.field__label)から、その項目の中を引く。 */
function field(label: string) {
  const head = screen.getAllByText(label, { selector: ".field__label" })[0];
  return within(head.closest(".field") as HTMLElement);
}

/** カテゴリのボタンの並び(画面の左上から順)。 */
function categoryButtons(): string[] {
  return field("カテゴリ")
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

function pressed(label: string): string | undefined {
  return field(label)
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-pressed") === "true")?.textContent ?? undefined;
}

function renderForm(props: Partial<Parameters<typeof ExpenseForm>[0]> = {}) {
  const onSaved = vi.fn();
  render(<ExpenseForm onSaved={onSaved} onCancel={() => {}} {...props} />);
  return { onSaved };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00"));
  mocks.past = [];
  mocks.added = [];
  mocks.updated = [];
  mocks.tags = {};
  mocks.savedTags = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ExpenseForm 項目の順番とボタン", () => {
  it("金額 → 店舗 → カテゴリ → 支払い方法 → 日付 の順に並び、プルダウンを使わない", () => {
    renderForm();
    const labels = [...document.querySelectorAll(".field__label")].map((el) => el.textContent);
    expect(labels).toEqual(["種類", "金額", "店舗", "カテゴリ", "支払い方法", "日付"]);
    expect(document.querySelector("select")).toBeNull();
  });

  it("カテゴリは最近よく使う順に並び、何も入れなければ先頭が選ばれる", async () => {
    mocks.past = [past("交通費"), past("交通費"), past("日用品"), past("交通費", { date: "2026-01-01" })];
    renderForm();
    await waitFor(() => expect(categoryButtons()[0]).toBe("交通費"));
    expect(categoryButtons().slice(0, 3)).toEqual(["交通費", "日用品", "食費"]);
    expect(pressed("カテゴリ")).toBe("交通費");
  });

  it("支払い方法はボタンで選び、保存する値は今までと同じ(クレカ → クレジットカード)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole("spinbutton", { name: /金額/ }), "1200");
    await user.click(field("支払い方法").getByRole("button", { name: "クレカ" }));
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() => expect(mocks.added).toHaveLength(1));
    expect(mocks.added[0]).toMatchObject({ type: "expense", amount: 1200, method: "クレジットカード" });
  });
});

describe("ExpenseForm 店名からカテゴリ", () => {
  it("店名を打つと、過去に同じ店で選んだカテゴリが入る", async () => {
    const user = userEvent.setup();
    mocks.past = [past("食費"), past("食費"), past("日用品", { store: "マツモトキヨシ 駅前店" })];
    renderForm();
    await waitFor(() => expect(pressed("カテゴリ")).toBe("食費"));
    await user.type(screen.getByRole("textbox", { name: /店舗/ }), "マツモト");
    expect(pressed("カテゴリ")).toBe("日用品");
    expect(screen.getByText(/の過去1件から/)).toBeTruthy();

    await user.type(screen.getByRole("spinbutton", { name: /金額/ }), "450");
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() => expect(mocks.added).toHaveLength(1));
    expect(mocks.added[0]).toMatchObject({ category: "日用品", store: "マツモト" });
  });

  it("自分でカテゴリを押したあとは、店名の推測で上書きしない", async () => {
    const user = userEvent.setup();
    mocks.past = [past("日用品", { store: "マツモトキヨシ" })];
    renderForm();
    await user.click(field("カテゴリ").getByRole("button", { name: "美容" }));
    await user.type(screen.getByRole("textbox", { name: /店舗/ }), "マツモトキヨシ");
    expect(pressed("カテゴリ")).toBe("美容");
    // 推測は、押せば入れ替えられる案内として残す
    await user.click(screen.getByRole("button", { name: /日用品にする/ }));
    expect(pressed("カテゴリ")).toBe("日用品");
  });
});

describe("ExpenseForm 収入と支出", () => {
  it("収入にすると、収入のカテゴリだけが出て、店舗・支払い方法は消える", async () => {
    const user = userEvent.setup();
    mocks.past = [past("副業", { type: "income" })];
    renderForm();
    await user.click(screen.getByRole("button", { name: "収入" }));
    await waitFor(() => expect(categoryButtons()).toEqual(["副業", "給与", "ボーナス", "臨時収入", "その他"]));
    expect(pressed("カテゴリ")).toBe("副業");
    expect(screen.queryByRole("textbox", { name: /店舗/ })).toBeNull();
    expect(screen.queryByText("支払い方法", { selector: ".field__label" })).toBeNull();

    await user.type(screen.getByRole("spinbutton", { name: /金額/ }), "30000");
    await user.click(screen.getByRole("button", { name: "記録する" }));
    await waitFor(() => expect(mocks.added).toHaveLength(1));
    expect(mocks.added[0]).toMatchObject({ type: "income", category: "副業", method: undefined, isFixed: false });
  });
});

describe("ExpenseForm 「詳しく」", () => {
  it("新しく記録するときは畳んであり、開くと案件・メモ・固定費が出る", async () => {
    const user = userEvent.setup();
    renderForm();
    const toggle = screen.getByRole("button", { name: /詳しく/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox", { name: /メモ/ })).toBeNull();

    await user.click(toggle);
    expect(screen.getByRole("textbox", { name: /メモ/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /案件/ })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /固定費の支払いとして記録する/ })).toBeTruthy();
  });

  it("メモの入った記録を編集するときは、最初から開いている", () => {
    renderForm({ initial: past("食費", { id: "t1", memo: "お弁当" }) });
    expect(screen.getByRole("button", { name: /詳しく/ }).getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByRole("textbox", { name: /メモ/ }) as HTMLTextAreaElement).value).toBe("お弁当");
  });

  it("案件タグの付いた記録を編集するときは、タグを読んでから開く", async () => {
    mocks.tags = { t2: "Aサイト制作" };
    renderForm({ initial: past("食費", { id: "t2" }) });
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: /案件/ }) as HTMLInputElement).value).toBe("Aサイト制作"),
    );
  });

  it("固定費として記録した支出を編集するときも開き、値は保ったまま保存する", async () => {
    const user = userEvent.setup();
    renderForm({ initial: past("その他", { id: "t3", isFixed: true, amount: 8000 }) });
    expect(screen.getByRole("switch", { name: /固定費/ }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("button", { name: "変更を保存" }));
    await waitFor(() => expect(mocks.updated).toHaveLength(1));
    expect(mocks.updated[0]).toEqual(["t3", expect.objectContaining({ isFixed: true, category: "その他", amount: 8000 })]);
  });
});

describe("ExpenseForm レシートの下書き・一覧に無い値", () => {
  it("レシートから開いた下書きは、読み取ったカテゴリ・支払い方法のまま新しく記録する", async () => {
    const user = userEvent.setup();
    // 過去の記録では同じ店が食費だが、下書きのカテゴリ(日用品)を店名の推測で上書きしない
    mocks.past = [past("食費", { store: "コンビニ" }), past("食費", { store: "コンビニ" })];
    renderForm({
      initial: past("日用品", { store: "コンビニ", method: "電子マネー", amount: 0, createdAt: 5 }),
      submitLabel: "この内容で記録する",
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /食費にする/ })).toBeTruthy());
    expect(pressed("カテゴリ")).toBe("日用品");
    expect(pressed("支払い方法")).toBe("電子マネー");
    // 金額 0(読めなかった)は空欄にして入力を促す
    expect((screen.getByRole("spinbutton", { name: /金額/ }) as HTMLInputElement).value).toBe("");

    await user.type(screen.getByRole("spinbutton", { name: /金額/ }), "640");
    await user.click(screen.getByRole("button", { name: "この内容で記録する" }));
    await waitFor(() => expect(mocks.added).toHaveLength(1));
    expect(mocks.added[0]).toMatchObject({ category: "日用品", method: "電子マネー", store: "コンビニ", amount: 640 });
    expect(mocks.updated).toHaveLength(0);
  });

  it("取り込みで入った一覧に無いカテゴリ・支払い方法は、ボタンを足して選んだまま見せる", () => {
    renderForm({ initial: past("ペット", { id: "t4", method: "PayPay" }) });
    expect(pressed("カテゴリ")).toBe("ペット");
    expect(pressed("支払い方法")).toBe("PayPay");
  });
});
