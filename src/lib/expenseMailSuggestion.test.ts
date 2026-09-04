import { describe, expect, it } from "vitest";
import type { SyncedEmail } from "../types";
import {
  detectAmount,
  detectStore,
  expenseSuggestionHint,
  isExpenseSuggestion,
  pickExpenseSuggestions,
  toExpenseSuggestion,
} from "./expenseMailSuggestion";

/** 2026-08-27 12:00 に届いたメール、として判定する。 */
const RECEIVED_AT = new Date(2026, 7, 27, 12, 0, 0).getTime();

function email(over: Partial<SyncedEmail> = {}): SyncedEmail {
  return {
    id: "m1",
    accountId: "a1",
    gmailMessageId: "g1",
    threadId: "t1",
    from: "Amazon.co.jp <auto-confirm@amazon.co.jp>",
    subject: "ご注文の確認",
    snippet: "合計 ¥3,480 のご注文を承りました。",
    receivedAt: RECEIVED_AT,
    status: "unprocessed",
    createdAt: RECEIVED_AT,
    ...over,
  };
}

describe("detectAmount", () => {
  it("¥表記も「円」表記も読む", () => {
    expect(detectAmount("合計 ¥3,480")).toBe(3_480);
    expect(detectAmount("合計 3,480円")).toBe(3_480);
  });

  it("全角で書かれていても読む", () => {
    expect(detectAmount("合計 ￥３，４８０")).toBe(3_480);
  });

  it("小計や送料が並んでいても、合計の近くの数字を採る", () => {
    expect(detectAmount("小計 5,000円 送料 500円 合計 2,000円")).toBe(2_000);
  });

  it("合計らしい言葉がどこにも無ければ、いちばん大きい数字を採る", () => {
    expect(detectAmount("商品A 1,200円 商品B 800円")).toBe(1_200);
  });

  it("桁が現実離れした数字は捨てる", () => {
    expect(detectAmount("会員番号 123456789012円")).toBeUndefined();
  });

  it("金額がまったく無ければ読めない", () => {
    expect(detectAmount("発送のお知らせです")).toBeUndefined();
  });
});

describe("detectStore", () => {
  it("差出人の表示名をそのまま店名にする", () => {
    expect(detectStore("Amazon.co.jp <auto-confirm@amazon.co.jp>")).toBe("Amazon.co.jp");
  });

  it("表示名が無ければドメインの頭を使う", () => {
    expect(detectStore("noreply@rakuten.co.jp")).toBe("rakuten");
  });
});

describe("isExpenseSuggestion", () => {
  it("買い物らしい言葉と金額が揃っていれば候補にする", () => {
    expect(isExpenseSuggestion(email())).toBe(true);
  });

  it("金額が無ければ候補にしない", () => {
    expect(isExpenseSuggestion(email({ snippet: "ご注文を承りました。" }))).toBe(false);
  });

  it("買い物らしい言葉が無ければ候補にしない", () => {
    expect(isExpenseSuggestion(email({ subject: "面接のご案内", snippet: "交通費 1,000円 を支給します" }))).toBe(
      false,
    );
  });

  it("宣伝メールは、金額と言葉が揃っていても候補にしない", () => {
    expect(isExpenseSuggestion(email({ subject: "セール開催中", snippet: "ご購入で 3,000円 割引" }))).toBe(false);
  });

  it("「あとで」を押したメールとスキップしたメールは出さない", () => {
    expect(isExpenseSuggestion(email({ expenseSuggestionDismissedAt: 1 }))).toBe(false);
    expect(isExpenseSuggestion(email({ status: "skipped" }))).toBe(false);
  });

  it("抜粋に無くても、取り込んだ本文の頭から拾う", () => {
    const withBody = email({ snippet: "詳細は下記のとおりです。", planText: "お支払い金額 8,900円" });
    expect(isExpenseSuggestion(withBody)).toBe(true);
  });
});

describe("toExpenseSuggestion", () => {
  it("金額・店名・日付をまとめる", () => {
    const suggestion = toExpenseSuggestion(email());
    expect(suggestion).toEqual({
      amount: 3_480,
      store: "Amazon.co.jp",
      date: "2026-08-27",
      hint: "¥3,480・Amazon.co.jp",
    });
  });

  it("本文に日付が書いてあればそちらを採る", () => {
    const suggestion = toExpenseSuggestion(email({ snippet: "8月20日 ご注文 合計 1,200円" }));
    expect(suggestion?.date).toBe("2026-08-20");
  });

  it("候補にならないメールは null", () => {
    expect(toExpenseSuggestion(email({ snippet: "発送しました" }))).toBeNull();
  });
});

describe("pickExpenseSuggestions / expenseSuggestionHint", () => {
  it("候補のメールだけを残す", () => {
    const rows = [email({ id: "a" }), email({ id: "b", subject: "面接", snippet: "よろしくお願いします" })];
    expect(pickExpenseSuggestions(rows).map((e) => e.id)).toEqual(["a"]);
  });

  it("候補でないメールの一言は空", () => {
    expect(expenseSuggestionHint(email({ snippet: "発送しました" }))).toBe("");
  });
});
