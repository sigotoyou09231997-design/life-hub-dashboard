import { describe, expect, it } from "vitest";
import { startWithEstimate } from "../feedbackStart.mjs";

const notFound = (name) => Object.assign(new Error(`${name} がまだ本番にありません`), { notFound: true, rpcName: name });

describe("startWithEstimate", () => {
  it("目安の分を丸めて渡し、付いたら ok。サーバーが収める範囲(1〜600)で報告する", async () => {
    const calls = [];
    const rpc = async (name, body) => (calls.push([name, body]), { ok: true });
    expect(await startWithEstimate(rpc, { code: "c", id: "x", minutes: 5.6 })).toEqual({ ok: true, minutes: 6 });
    expect(calls).toEqual([["app_feedback_start", { p_code: "c", p_id: "x", p_minutes: 6 }]]);
    expect(await startWithEstimate(rpc, { code: "c", id: "x", minutes: 5000 })).toEqual({ ok: true, minutes: 600 });
  });

  it("037 がまだ本番に無い(関数が無い)時は、投げずに「no-function」と返す(呼んだ側が目安なしで進める)", async () => {
    const rpc = async (name) => {
      throw notFound(name);
    };
    expect(await startWithEstimate(rpc, { code: "c", id: "x", minutes: 6 })).toEqual({ ok: false, reason: "no-function" });
  });

  it("別の関数が無い・通信の失敗・コードが違うなどは、そのまま投げる(付いたふりをしない)", async () => {
    await expect(startWithEstimate(async () => { throw notFound("app_feedback_set_status"); }, { code: "c", id: "x", minutes: 6 })).rejects.toThrow("まだ本番にありません");
    await expect(startWithEstimate(async () => { throw new Error("app_feedback_start が失敗しました(500)"); }, { code: "c", id: "x", minutes: 6 })).rejects.toThrow("500");
    await expect(startWithEstimate(async () => ({ ok: false, reason: "invalid_code" }), { code: "c", id: "x", minutes: 6 })).rejects.toThrow("invalid_code");
    await expect(startWithEstimate(async () => ({ ok: false, reason: "not_found" }), { code: "c", id: "x", minutes: 6 })).rejects.toThrow("not_found");
  });
});
