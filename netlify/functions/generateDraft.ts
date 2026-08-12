import type { Handler } from "@netlify/functions";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

interface BusySlot {
  date: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
}

interface GenerateDraftBody {
  from: string;
  subject: string;
  body: string;
  busySlots?: BusySlot[];
}

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function formatBusySlots(slots: BusySlot[] | undefined): string {
  if (!slots || slots.length === 0) return "(予定なし)";
  return slots
    .map((s) => {
      if (s.allDay) return `${s.date} 終日`;
      if (s.startTime && s.endTime) return `${s.date} ${s.startTime}-${s.endTime}`;
      if (s.startTime) return `${s.date} ${s.startTime}〜`;
      return s.date;
    })
    .join("\n");
}

const POINTS_MARKER = "[ポイント]";
const CANDIDATES_MARKER = "[候補日]";
const BODY_MARKER = "[本文]";

export interface CandidateDate {
  date: string;
  startTime?: string;
  endTime?: string;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** Mirrors the exact "M/D(曜) HH:mm〜HH:mm" wording the system prompt requires the
 * model to use in [本文] when it proposes a date — the client relies on this same
 * format (duplicated in src/lib/gmail.ts) to find-and-replace a date the user edits. */
export function formatCandidateLabel(slot: CandidateDate): string {
  const d = new Date(`${slot.date}T00:00:00`);
  const md = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_JA[d.getDay()]})`;
  if (slot.startTime && slot.endTime) return `${md} ${slot.startTime}〜${slot.endTime}`;
  if (slot.startTime) return `${md} ${slot.startTime}〜`;
  return md;
}

function parseCandidateLines(section: string): CandidateDate[] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [date, startTime, endTime] = line.split("|").map((p) => p.trim());
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      return [{ date, startTime: startTime || undefined, endTime: endTime || undefined }];
    });
}

/** Splits the model's [ポイント]/[候補日]/[本文] sections apart. Falls back to treating
 * the whole response as the body (no points/dates) if the model didn't follow the format. */
export function parseModelOutput(text: string): { keyPoints: string[]; candidateDates: CandidateDate[]; body: string } {
  const bodyIdx = text.indexOf(BODY_MARKER);
  if (bodyIdx === -1) return { keyPoints: [], candidateDates: [], body: text.trim() };

  const candidatesIdx = text.indexOf(CANDIDATES_MARKER);
  const pointsIdx = text.indexOf(POINTS_MARKER);
  const pointsEnd = candidatesIdx !== -1 ? candidatesIdx : bodyIdx;
  const pointsSection = pointsIdx !== -1 ? text.slice(pointsIdx + POINTS_MARKER.length, pointsEnd) : "";
  const keyPoints = pointsSection
    .split("\n")
    .map((line) => line.trim().replace(/^[-・]\s*/, ""))
    .filter(Boolean);

  const candidateDates = candidatesIdx !== -1 ? parseCandidateLines(text.slice(candidatesIdx + CANDIDATES_MARKER.length, bodyIdx)) : [];

  const body = text.slice(bodyIdx + BODY_MARKER.length).trim();
  return { keyPoints, candidateDates, body };
}

/** Defensive cleanup for when the model includes the greeting/closing our fixed
 * template already adds despite the system prompt telling it not to — without
 * this, "お世話になっております。船田です。" (or the closing) could end up doubled. */
export function stripKnownGreetingAndClosing(body: string): string {
  let result = body;
  result = result.replace(/^\s*お世話になっております[。.]?\s*\n*/, "");
  result = result.replace(/^\s*船田です[。.]?\s*\n*/, "");
  result = result.replace(/\s*以上、?よろしくお願い(いたします|します)[。.]?\s*$/, "");
  return result.trim();
}

const SYSTEM_PROMPT = `あなたはユーザーの代わりにメール返信を検討するアシスタントです。必ず以下の構成で出力してください(${BODY_MARKER}内で日程を提案しない場合は${CANDIDATES_MARKER}セクション自体を省略してよい)。

${POINTS_MARKER}
返信で押さえておくべき点を2〜4個、箇条書きで(各行「- 」から始める)。相手の質問・依頼への回答や、使うとよい言葉・フレーズなど。

${CANDIDATES_MARKER}
${BODY_MARKER}内で日程(面接・打ち合わせ等の候補日)を提案する場合のみ、提案した日付を1行1件、
"YYYY-MM-DD|開始HH:mm|終了HH:mm" の形式で出力する(時刻未定なら2〜3列目は空でよい。例: 2026-08-20|14:00|15:00 や 2026-08-21|| )。

${BODY_MARKER}
受信メールへの返信文の、要件部分の本文のみ(そのメールと同じ言語)。件名は含めない。
冒頭の挨拶(「お世話になっております」等)・名乗り(「船田です」等)・結びの言葉(「よろしくお願いします」等)は
呼び出し側で別途付け足すので、${BODY_MARKER}にはそれらを一切含めず、要件そのものから書き始めること。
日程を提案する場合、本文中でその日付は必ず「M/D(曜) HH:mm〜HH:mm」の形式で書き(例: 8/20(木) 14:00〜15:00、時刻未定なら「8/20(木)」のみ)、
${CANDIDATES_MARKER}に書いた内容と表記を完全に一致させること(この表記が一致しないと、ユーザーが日付を後から変更できなくなる)。

共通ルール:
- 簡潔かつ丁寧な文面にする
- ${POINTS_MARKER}に挙げた点は、要約として別表示するためのものであり、必ず全て${BODY_MARKER}の文面自体にも反映すること。${POINTS_MARKER}にだけ書いて${BODY_MARKER}に書かない、ということがあってはならない
- 受信メール、および渡された「予定が入っている日時」に書かれていない事実を作り上げない
- 相手が日程調整(面接・打ち合わせ等の候補日)を求めている場合、「予定が入っている日時」に記載のない日から2〜3件、具体的な候補日(可能なら時間帯も)を提案してよい。予定情報が空の場合は候補日を作り上げず、一般的な調整の申し出にとどめる
- 上記のセクション以外の説明や前置きは書かない`;

/** Proxies Anthropic's Messages API so the API key never reaches the browser. */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "Anthropic API is not configured on the server" });
  }

  let payload: GenerateDraftBody;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }
  if (!payload.from || !payload.subject || !payload.body) {
    return jsonResponse(400, { error: "from, subject, and body are required" });
  }

  const userMessage = `差出人: ${payload.from}\n件名: ${payload.subject}\n本文:\n${payload.body}\n\n予定が入っている日時(候補日を提案する場合はこれらを避ける):\n${formatBusySlots(payload.busySlots)}`;

  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(res.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const generated = data.content.find((block) => block.type === "text")?.text ?? "";
  const { keyPoints, candidateDates, body: generatedBody } = parseModelOutput(generated);
  const cleanedBody = stripKnownGreetingAndClosing(generatedBody);
  const draft = `お世話になっております。\n船田です。\n\n${cleanedBody}\n\n以上、よろしくお願いします。`;
  const candidateDatesWithLabel = candidateDates.map((c) => ({ ...c, label: formatCandidateLabel(c) }));

  return jsonResponse(200, { draft, keyPoints, candidateDates: candidateDatesWithLabel });
};
