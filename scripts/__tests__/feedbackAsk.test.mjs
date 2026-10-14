import { describe, expect, it } from "vitest";
import { askWithOptions, readOptions } from "../feedbackAsk.mjs";

const notFound = (name) => Object.assign(new Error(`${name} がまだ本番にありません`), { notFound: true, rpcName: name });

describe("readOptions(--option の値を取り出す)", () => {
  it("書いた順に取り出す。前後の空白は落とし、空・重複は除き、60字に切る", () => {
    expect(readOptions(["--hold", "id", "質問", "--option", " A ", "--option", "B", "--option", "", "--option", "A", "--option", "あ".repeat(80)])).toEqual(["A", "B", "あ".repeat(60)]);
    expect(readOptions(["--hold", "id", "質問"])).toEqual([]);
    expect(readOptions(["--option"])).toEqual([]);
  });
});

describe("askWithOptions(質問つきで保留中にする)", () => {
  it("質問と選択肢を渡して、付けられたら ok", async () => {
    const calls = [];
    const rpc = async (name, body) => (calls.push([name, body]), { ok: true });
    expect(await askWithOptions(rpc, { code: "c", id: "x", note: "どれ?", options: ["A", "B"] })).toEqual({ ok: true, options: ["A", "B"] });
    expect(calls).toEqual([["app_feedback_ask", { p_code: "c", p_id: "x", p_note: "どれ?", p_options: ["A", "B"] }]]);
  });

  it("選択肢が2つ未満・7つ以上なら、サーバーに聞く前に断る", async () => {
    const rpc = async () => ({ ok: true });
    await expect(askWithOptions(rpc, { code: "c", id: "x", note: "", options: ["A"] })).rejects.toThrow("2〜6つ");
    await expect(askWithOptions(rpc, { code: "c", id: "x", note: "", options: ["1", "2", "3", "4", "5", "6", "7"] })).rejects.toThrow("2〜6つ");
  });

  it("039 がまだ本番に無い時は、投げずに no-function(呼んだ側が、質問なしの保留中にする)。それ以外の失敗は、そのまま投げる", async () => {
    expect(await askWithOptions(async (name) => { throw notFound(name); }, { code: "c", id: "x", note: "", options: ["A", "B"] })).toEqual({ ok: false, reason: "no-function" });
    await expect(askWithOptions(async () => { throw notFound("app_feedback_hold"); }, { code: "c", id: "x", note: "", options: ["A", "B"] })).rejects.toThrow("まだ本番にありません");
    await expect(askWithOptions(async () => ({ ok: false, reason: "invalid_options" }), { code: "c", id: "x", note: "", options: ["A", "B"] })).rejects.toThrow("invalid_options");
  });
});
