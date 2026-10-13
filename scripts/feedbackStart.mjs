// 修正中にして、かかる時間の目安(分)を付ける(scripts/feedback-inbox.mjs --working <id> --estimate <分> が使う。試験できる)。
//
// 037(app_feedback_start)がまだ本番に無い時は、何も変えずに { ok: false, reason: "no-function" } を返す。
// 呼んだ側は、目安なしの「修正中」にして進める(直す作業は止めない)。それ以外の失敗は、そのまま投げる(付いたふりをしない)。

/**
 * @param {(name: string, body: object) => Promise<any>} rpc  サーバーの関数を呼ぶ。「関数が無い」時は notFound が付いた Error を投げる
 * @param {{ code: string, id: string, minutes: number }} args
 * @returns {Promise<{ ok: true, minutes: number } | { ok: false, reason: "no-function" }>}
 */
export async function startWithEstimate(rpc, { code, id, minutes }) {
  const rounded = Math.round(minutes);
  let result;
  try {
    result = await rpc("app_feedback_start", { p_code: code, p_id: id, p_minutes: rounded });
  } catch (err) {
    if (err?.notFound && err.rpcName === "app_feedback_start") return { ok: false, reason: "no-function" };
    throw err;
  }
  if (!result?.ok) throw new Error(`修正中にできませんでした(${result?.reason ?? "不明"})`);
  return { ok: true, minutes: Math.max(1, Math.min(600, rounded)) };
}
