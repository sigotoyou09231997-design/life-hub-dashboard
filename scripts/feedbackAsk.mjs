// 保留中にして、送った人に質問(選ぶボタン)を付ける(scripts/feedback-inbox.mjs --hold <id> "質問" --option "A" --option "B" …。試験できる)。
//
// 質問(理由)は300字まで、選択肢は2〜6つ・1つ60字まで(サーバー supabase/sql/039 と同じ)。選択肢が1つ以下なら、質問なしの保留中(--hold の今までの形)。
// 039 をまだ流していない時は、質問は付けられず、質問なしの「保留中」だけ付く(呼んだ側が知らせる)。

/** 引数から --option の値を全部取り出す(前後の空白を落とし、空と重複は除く。順番は書いた順)。 */
export function readOptions(args) {
  const options = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--option") continue;
    const value = String(args[i + 1] ?? "").trim().slice(0, 60);
    if (value && !options.includes(value)) options.push(value);
  }
  return options;
}

/** 保留中の依頼に質問を付ける。付けた(ok)か、サーバーに 039 が無い(no-function)かを返す。それ以外の失敗は投げる。 */
export async function askWithOptions(rpc, { code, id, note, options }) {
  if (options.length < 2 || options.length > 6) throw new Error("--option は2〜6つ入れてください(ボタンの選択肢)");
  let result;
  try {
    result = await rpc("app_feedback_ask", { p_code: code, p_id: id, p_note: note, p_options: options });
  } catch (err) {
    if (err?.notFound && err.rpcName === "app_feedback_ask") return { ok: false, reason: "no-function" };
    throw err;
  }
  if (!result?.ok) throw new Error(`質問を付けて保留中にできませんでした(${result?.reason ?? "不明"})`);
  return { ok: true, options };
}
