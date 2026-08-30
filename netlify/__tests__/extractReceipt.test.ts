import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "../../src/lib/categories";
import { parseReceiptResponse, pickResponseText, SYSTEM_PROMPT } from "../functions/extractReceipt";
import {
  parseReceiptResponse as vercelParseReceiptResponse,
  pickResponseText as vercelPickResponseText,
  SYSTEM_PROMPT as VERCEL_SYSTEM_PROMPT,
} from "../../api/extractReceipt";

describe("parseReceiptResponse", () => {
  it("店名・日付・金額・カテゴリを読み取る", () => {
    const receipt = parseReceiptResponse(
      JSON.stringify({ receipt: { storeName: "いつものスーパー", date: "2026-08-20", amount: 1234, category: "食費", paymentMethod: "現金" } }),
    );
    expect(receipt).toEqual({
      storeName: "いつものスーパー",
      date: "2026-08-20",
      amount: 1234,
      category: "食費",
      paymentMethod: "現金",
      memo: undefined,
    });
  });

  it("一部しか読み取れなくても、読み取れた分だけ返す", () => {
    const receipt = parseReceiptResponse(JSON.stringify({ receipt: { amount: 500 } }));
    expect(receipt).toEqual({ storeName: undefined, date: undefined, amount: 500, category: undefined, paymentMethod: undefined, memo: undefined });
  });

  it("店名・日付・金額のいずれも読み取れなければnull", () => {
    expect(parseReceiptResponse(JSON.stringify({ receipt: { category: "食費" } }))).toBeNull();
  });

  it("読み取れなかった旨のreceipt:nullはnullを返す", () => {
    expect(parseReceiptResponse(JSON.stringify({ receipt: null }))).toBeNull();
  });

  it("選択肢に無いカテゴリ・支払い方法は落とす", () => {
    const receipt = parseReceiptResponse(
      JSON.stringify({ receipt: { amount: 500, category: "そんざいしない", paymentMethod: "仮想通貨" } }),
    );
    expect(receipt?.category).toBeUndefined();
    expect(receipt?.paymentMethod).toBeUndefined();
  });

  it("日付が不正な形式なら落とす", () => {
    const receipt = parseReceiptResponse(JSON.stringify({ receipt: { amount: 500, date: "8月20日" } }));
    expect(receipt?.date).toBeUndefined();
  });

  it("0円・マイナス・文字混じりの金額は落とす", () => {
    expect(parseReceiptResponse(JSON.stringify({ receipt: { storeName: "店", amount: 0 } }))?.amount).toBeUndefined();
    expect(parseReceiptResponse(JSON.stringify({ receipt: { storeName: "店", amount: -100 } }))?.amount).toBeUndefined();
  });

  it("説明文やコードフェンス付きの応答からも取り出す", () => {
    const receipt = parseReceiptResponse('了解しました。\n```json\n{"receipt":{"amount":800}}\n```');
    expect(receipt?.amount).toBe(800);
  });

  it("JSONとして壊れている・空の応答はnull", () => {
    expect(parseReceiptResponse("読み取れませんでした")).toBeNull();
    expect(parseReceiptResponse('{"receipt":{"amount":500')).toBeNull();
  });
});

describe("pickResponseText", () => {
  // claude-sonnet-5 は thinking の指定を省くと考えながら答えるので、content の先頭に
  // text を持たない塊が入る。ここを先頭決め打ちで読んでいると、読み取れているのに
  // 「AIから読み取り結果を取得できませんでした」になる(旅行の読み取りで起きた事故)。
  const answer = '{"receipt":{"amount":500}}';
  const thinking = { type: "thinking", thinking: "…" } as unknown as { type: string; text?: string };

  it("考えてから答えた応答でも、本文を取り出す", () => {
    expect(pickResponseText([thinking, { type: "text", text: answer }])).toBe(answer);
  });

  it("先頭が本文のときはそのまま取り出す", () => {
    expect(pickResponseText([{ type: "text", text: answer }])).toBe(answer);
  });

  it("本文が1つも無ければ空", () => {
    expect(pickResponseText([thinking])).toBe("");
    expect(pickResponseText([])).toBe("");
    expect(pickResponseText(undefined)).toBe("");
  });
});

describe("Netlify版とVercel版のずれ", () => {
  const cases = [
    JSON.stringify({ receipt: { storeName: "いつものスーパー", date: "2026-08-20", amount: 1234, category: "食費" } }),
    JSON.stringify({ receipt: { amount: 500, category: "そんざいしない" } }),
    JSON.stringify({ receipt: null }),
    "読み取れませんでした",
    '{"receipt":{"amount":500',
  ];

  it("応答の読み取りが、どちらも同じ結果になる", () => {
    for (const text of cases) {
      expect(vercelParseReceiptResponse(text)).toEqual(parseReceiptResponse(text));
    }
  });

  it("AIへの指示も同じ", () => {
    expect(VERCEL_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
  });

  it("応答から本文を取り出すところも同じ", () => {
    const thinking = { type: "thinking" } as unknown as { type: string; text?: string };
    const contents = [
      [{ type: "text", text: '{"receipt":{"amount":500}}' }],
      [thinking, { type: "text", text: '{"receipt":{"amount":500}}' }],
      [thinking],
      [],
    ];
    for (const content of contents) {
      expect(vercelPickResponseText(content)).toBe(pickResponseText(content));
    }
  });
});

describe("選択肢の一致", () => {
  // カテゴリ・支払い方法はsrc/lib/categories.tsから読み取り関数側へ複製してある
  // (netlify functionsはsrc/からimportできないため)。ずれると、AIが選べる選択肢と
  // 支出フォームの選択肢が食い違う。
  it("AIに提示するカテゴリ・支払い方法が、実際のフォームの選択肢と一致する", () => {
    expect(SYSTEM_PROMPT).toContain(EXPENSE_CATEGORIES.join("、"));
    expect(SYSTEM_PROMPT).toContain(PAYMENT_METHODS.join("、"));
  });
});
