// scripts/ui-check.mjs の、操作の指定(--step "…")を読む部分。ブラウザに依存しないので、試験できる。
//
// 書き方:  <操作>:<場所>[=<値>]
//   操作:  click / fill(=値が要る) / press(場所の所に押すキー) / wait(場所の所にミリ秒) / shot(場所の所にファイル名) /
//          scroll / expect(あれば成功) / expect-not(無ければ成功) / expect-text(=値 が含まれていれば成功) / count(数を出す)
//   場所:  role:<役割>:<名前> | text:<文字> | placeholder:<文字> | label:<文字> | css:<セレクタ> | testid:<id>
//          名前・文字は /正規表現/ でも書ける。末尾に @first / @last / @nth=<番号> を付けると、複数あっても1つに絞れる
//          (付けないで複数に当たると、押す・入れる系は「複数あります」で止まる — 間違った所を押さないため)。
//   値:    最後の「=」より後ろ(場所や名前に「=」を含む時は、値の前に必ず「=」を付ける)。

const NEEDS_TARGET = new Set(["click", "fill", "scroll", "expect", "expect-not", "expect-text", "count"]);
const NEEDS_VALUE = new Set(["fill", "expect-text"]);
const OWN_ARG = new Set(["press", "wait", "shot"]);

/** 名前・文字: /…/ なら正規表現、そうでなければ文字そのまま。 */
export function asMatcher(text) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(text);
  return m ? new RegExp(m[1], m[2]) : text;
}

/** 場所の指定(末尾の @first / @last / @nth=N を分けて、種類と中身を返す)。 */
export function parseTarget(text) {
  let rest = text.trim();
  let pick = null;
  const at = /@(first|last|nth=(\d+))$/.exec(rest);
  if (at) {
    pick = at[1] === "first" ? { first: true } : at[1] === "last" ? { last: true } : { nth: Number(at[2]) };
    rest = rest.slice(0, at.index);
  }
  const colon = rest.indexOf(":");
  if (colon < 0) throw new Error(`場所は「種類:中身」の形で書いてください: ${text}`);
  const kind = rest.slice(0, colon);
  const body = rest.slice(colon + 1);
  if (kind === "role") {
    const second = body.indexOf(":");
    if (second < 0) return { kind, role: body, name: undefined, pick };
    return { kind, role: body.slice(0, second), name: asMatcher(body.slice(second + 1)), pick };
  }
  if (!["text", "placeholder", "label", "css", "testid"].includes(kind)) throw new Error(`知らない場所の種類です: ${kind}`);
  return { kind, value: kind === "css" || kind === "testid" ? body : asMatcher(body), pick };
}

export function parseStep(text) {
  const colon = text.indexOf(":");
  if (colon < 0) throw new Error(`操作は「操作:場所」の形で書いてください: ${text}`);
  const action = text.slice(0, colon).trim();
  const rest = text.slice(colon + 1);
  if (OWN_ARG.has(action)) return { action, arg: rest.trim(), text };
  if (!NEEDS_TARGET.has(action)) throw new Error(`知らない操作です: ${action}`);
  let targetText = rest;
  let value;
  if (NEEDS_VALUE.has(action)) {
    const eq = rest.lastIndexOf("=");
    if (eq < 0) throw new Error(`${action} は「=値」が要ります: ${text}`);
    targetText = rest.slice(0, eq);
    value = rest.slice(eq + 1);
  }
  return { action, target: parseTarget(targetText), value, text };
}

/** 差し替えの指定「<元のファイル>=<差し替えのファイル>」を分ける。 */
export function parseStub(text) {
  const eq = text.lastIndexOf("=");
  if (eq <= 0) throw new Error(`--stub は「元のファイル=差し替えのファイル」の形で書いてください: ${text}`);
  return { real: text.slice(0, eq), stub: text.slice(eq + 1) };
}
