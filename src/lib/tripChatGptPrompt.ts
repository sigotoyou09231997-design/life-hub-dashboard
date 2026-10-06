import { parseDate, tripDayList, tripDurationLabel } from "./date";
import type { Trip } from "../types";

/**
 * ChatGPT に旅程を作ってもらうための依頼文を組み立てる。
 *
 * 返ってきた文章は、そのまま「写真・文章から読み取る」(src/lib/tripPlanScan.ts)に貼って
 * 日程に起こす。なので依頼文の中心は、条件より**書き方の指定**にある — 読み取り側が
 * 取りこぼさない形(日ごとの見出し + 時刻から始まる1行1件)で返させる。
 * 規則の根拠は、読み取り側のプロンプト(api/extractTripPlan.ts の SYSTEM_PROMPT)と
 * 日の見出しの判定(tripPlanScan.ts の isDayHeading):
 * - 日の見出しは「■2026/12/27(日)」の形。ここで文章を日ごとに分けて読むので、見出しが
 *   崩れる(Markdownの「**」や「###」・表)と、複数日が1回に詰まって後ろの日が切れる。
 * - 時刻付きの行は1行1件。起床・出発・休憩のような区切りも入れる。
 * - 金額は書かせない。読み取りは金額を費用として積むので、ChatGPT の見積もりが
 *   そのまま旅行の費用に入ってしまう。
 * - 24時を過ぎる予定は書かせない。日をまたぐ判定は読み取り側の推測になるため。
 */

export type TripPace = "relaxed" | "normal" | "packed";

export const PACE_OPTIONS: { value: TripPace; label: string; perDay: string }[] = [
  { value: "relaxed", label: "ゆったり", perDay: "5〜8行" },
  { value: "normal", label: "ふつう", perDay: "8〜12行" },
  { value: "packed", label: "しっかり", perDay: "12〜16行" },
];

export interface TripPromptPrefs {
  /** 出発地。空なら、現地に着いたところから書かせる。 */
  origin: string;
  /** 同行者(「大人2人」「子ども連れ」など)。 */
  party: string;
  /** 移動手段(「電車」「レンタカー」など)。 */
  transport: string;
  pace: TripPace;
  /** 行きたい所・やりたいこと。 */
  wishes: string;
}

export const EMPTY_PROMPT_PREFS: TripPromptPrefs = {
  origin: "",
  party: "",
  transport: "",
  pace: "normal",
  wishes: "",
};

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** 「2026/12/27(日)」。年を付けるのは、年をまたぐ旅行で 1/1 がどの年か迷わせないため。 */
function dateLabel(date: string): string {
  const d = parseDate(date);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_JA[d.getDay()]})`;
}

/** 日の見出し。読み取り側が「1日ぶんの欄の始まり」と判定する形(■ + 日付 + 曜日)。 */
export function dayHeading(date: string): string {
  return `■${dateLabel(date)}`;
}

/** 複数行の入力を1行にする。条件の欄の中で行が増えると、箇条書きが崩れて読み違えるため。 */
function oneLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ");
}

export function buildTripPrompt(
  trip: Pick<Trip, "name" | "destination" | "startDate" | "endDate" | "memo" | "budget">,
  prefs: TripPromptPrefs,
): string {
  const days = tripDayList(trip.startDate, trip.endDate);
  const pace = PACE_OPTIONS.find((option) => option.value === prefs.pace) ?? PACE_OPTIONS[1];
  const origin = oneLine(prefs.origin);

  const conditions: string[] = [`・旅行名: ${trip.name}`];
  const destination = trip.destination?.trim();
  if (destination) conditions.push(`・行き先: ${destination}`);
  if (days.length > 0) {
    const duration = tripDurationLabel(trip.startDate, trip.endDate);
    conditions.push(`・期間: ${dateLabel(days[0])}〜${dateLabel(days[days.length - 1])}(${duration})`);
  }
  if (origin) conditions.push(`・出発地: ${origin}`);
  if (oneLine(prefs.party)) conditions.push(`・同行者: ${oneLine(prefs.party)}`);
  if (oneLine(prefs.transport)) conditions.push(`・移動手段: ${oneLine(prefs.transport)}`);
  conditions.push(`・ペース: ${pace.label}(1日あたり ${pace.perDay}ほど)`);
  if (trip.budget && trip.budget > 0) conditions.push(`・予算: ${trip.budget.toLocaleString("ja-JP")}円(旅行全体の目安)`);
  if (oneLine(prefs.wishes)) conditions.push(`・行きたい所・やりたいこと: ${oneLine(prefs.wishes)}`);
  if (trip.memo && oneLine(trip.memo)) conditions.push(`・メモ: ${oneLine(trip.memo)}`);

  const rules: string[] = [
    "プレーンテキストだけで書く。表・Markdown記法(#、*、-、太字)・絵文字・リンクは使わない。",
  ];
  if (days.length > 0) {
    rules.push(
      `日ごとに、見出しを1行だけ置く。形は「${dayHeading(days[0])} 〇〇→△△」。日付と曜日はそのまま、題は15文字以内。見出しは次の${days.length}つを、この順で全部作る:\n${days.map(dayHeading).join("\n")}`,
    );
  } else {
    rules.push("日ごとに、見出しを1行だけ置く。形は「■2026/12/27(日) 〇〇→△△」。題は15文字以内。");
  }
  rules.push(
    "見出しの下に、予定を1行1件で書く。どの行も、先頭に24時間表記の時刻(例 08:30)を付ける。",
    "起床・朝食・ホテル出発・昼食・チェックイン・休憩のような1日の動きの区切りも、時刻を付けた1行にする。「出発」だけの行にはせず、「ホテル出発」のように場所を添える。",
    "移動は「09:00 □□駅 → ◇◇駅 (JR特急 約1時間)」のように、出発地と到着地が分かる1行にする。往路と復路、チェックインとチェックアウトは別々の行にする。",
    "場所・店・施設は実在する名称で書く。確かでないものは一般的な呼び名にとどめ、それらしい名前を作らない。",
    "24時を過ぎる予定は書かず、夜は23時台までに終える。",
    "料金・金額は書かない。",
    "雨天の別案・補足の注意書き・「↓」でつないだ経路・まとめ・おすすめ一覧は付けない。実際に行く予定だけを並べる。",
    origin
      ? "初日は出発地を出るところから、最終日は出発地に帰り着くところまでを書く。"
      : "出発地は決まっていないので、初日は現地に着いたところから、最終日は現地を出るところまでを書く。",
    "前置き・あいさつ・最後の一言は付けず、最初の見出しから始めて、最後の予定で終える。",
  );

  const example = [
    days.length > 0 ? `${dayHeading(days[0])} 〇〇→△△` : "■2026/12/27(日) 〇〇→△△",
    "07:00 起床・朝食",
    "08:30 ホテル出発",
    "09:00 □□駅 → ◇◇駅 (JR特急 約1時間)",
    "10:30 □□神社 参拝",
    "12:00 昼食 ◇◇(店名)",
    "15:00 ホテルにチェックイン",
  ];

  return [
    "旅行の日程を作ってください。質問は返さず、足りない所は一般的な前提で決めて、日程の本文だけを返してください。",
    "",
    "【旅行の条件】",
    ...conditions,
    "",
    "【書き方のルール】",
    "この返事は、そのまま日程表アプリに貼り付けて読み取らせます。次の形を必ず守ってください。",
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    "【書き方の例】",
    ...example,
  ].join("\n");
}
