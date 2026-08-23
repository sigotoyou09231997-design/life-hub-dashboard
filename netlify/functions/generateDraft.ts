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
  /** Reply mode: from/subject/body (of the *received* email being replied to) are all
   * present together. Compose mode (a brand-new message, no thread to reply within) omits
   * all three and supplies `to` instead — see the `isReply` branch in the handler below. */
  from?: string;
  subject?: string;
  body?: string;
  /** Compose-mode only: recipient of the new message. */
  to?: string;
  busySlots?: BusySlot[];
  userNotes?: string;
  /** The reply draft currently shown on screen (unsaved edits included), when
   * regenerating an existing draft. Without this, each generation call is
   * stateless — the model never sees its own prior output — so a userNotes
   * instruction like "この日付消して" that assumes shared context (the way it
   * would in an ordinary Claude/ChatGPT chat) has nothing for "この" to resolve
   * against. Omitted on first-time generation, when there's no draft yet. */
  currentDraft?: string;
  /** Bodies of the user's own past sent replies (most recent first), used as
   * few-shot examples so the AI's tone/wording matches how the user actually
   * writes without requiring the user to describe their own style. */
  styleExamples?: string[];
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
const EARLIEST_DATE_MARKER = "[日程制約]";
const SUBJECT_MARKER = "[件名]";
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

/** Splits the model's [ポイント]/[候補日]/[日程制約]/[件名]/[本文] sections apart. Falls
 * back to treating the whole response as the body (no points/dates/subject) if the
 * model didn't follow the format. Section boundaries chain forward through whichever
 * optional markers are actually present, ending at [本文] (always last, and always
 * required — everything after it is body text). */
export function parseModelOutput(text: string): {
  keyPoints: string[];
  candidateDates: CandidateDate[];
  earliestDate: string;
  subject: string;
  body: string;
} {
  const bodyIdx = text.indexOf(BODY_MARKER);
  if (bodyIdx === -1) return { keyPoints: [], candidateDates: [], earliestDate: "", subject: "", body: text.trim() };

  const subjectIdx = text.indexOf(SUBJECT_MARKER);
  const earliestDateIdx = text.indexOf(EARLIEST_DATE_MARKER);
  const candidatesIdx = text.indexOf(CANDIDATES_MARKER);
  const pointsIdx = text.indexOf(POINTS_MARKER);

  const pointsEnd = candidatesIdx !== -1 ? candidatesIdx : earliestDateIdx !== -1 ? earliestDateIdx : subjectIdx !== -1 ? subjectIdx : bodyIdx;
  const pointsSection = pointsIdx !== -1 ? text.slice(pointsIdx + POINTS_MARKER.length, pointsEnd) : "";
  const keyPoints = pointsSection
    .split("\n")
    .map((line) => line.trim().replace(/^[-・]\s*/, ""))
    .filter(Boolean);

  const candidatesEnd = earliestDateIdx !== -1 ? earliestDateIdx : subjectIdx !== -1 ? subjectIdx : bodyIdx;
  const candidateDates = candidatesIdx !== -1 ? parseCandidateLines(text.slice(candidatesIdx + CANDIDATES_MARKER.length, candidatesEnd)) : [];

  const earliestDateEnd = subjectIdx !== -1 ? subjectIdx : bodyIdx;
  const earliestDateRaw =
    earliestDateIdx !== -1 ? (text.slice(earliestDateIdx + EARLIEST_DATE_MARKER.length, earliestDateEnd).trim().split("\n")[0] ?? "").trim() : "";
  const earliestDate = /^\d{4}-\d{2}-\d{2}$/.test(earliestDateRaw) ? earliestDateRaw : "";

  const subject = subjectIdx !== -1 ? (text.slice(subjectIdx + SUBJECT_MARKER.length, bodyIdx).trim().split("\n")[0] ?? "").trim() : "";

  const body = text.slice(bodyIdx + BODY_MARKER.length).trim();
  return { keyPoints, candidateDates, earliestDate, subject, body };
}

/** Builds the Messages API user turn from the request payload. userNotes (free-text
 * instructions from the DraftReview.tsx textarea) is appended as its own labeled
 * section, only when non-blank, so the model treats it as a distinct override rather
 * than conflating it with the original email's own content. */
export function buildUserMessage(payload: GenerateDraftBody): string {
  const styleExamplesSection =
    payload.styleExamples && payload.styleExamples.length > 0
      ? `\n\n過去にユーザーが実際に送信した返信の例(口調・言葉遣い・文の長さなど書き方の傾向をつかむための参考。内容やこの例文の文言そのものを今回の返信に流用しないこと):\n${payload.styleExamples
          .map((ex, i) => `【例${i + 1}】\n${ex.trim()}`)
          .join("\n\n")}`
      : "";
  const currentDraftSection = payload.currentDraft?.trim()
    ? `\n\n現在の下書き本文(直前にAIが生成し、ユーザーが今画面で見ているもの。ユーザーからの追加指示内の「これ」「上記」「この日付」等の指示語は、この下書き本文中の該当箇所を指している可能性が高い):\n${payload.currentDraft.trim()}`
    : "";
  const userNotesSection = payload.userNotes?.trim()
    ? `\n\nユーザーからの追加指示(必ず反映すること):\n${payload.userNotes.trim()}`
    : "";
  return `差出人: ${payload.from}\n件名: ${payload.subject}\n本文:\n${payload.body}\n\n予定が入っている日時(候補日を提案する場合はこれらを避ける):\n${formatBusySlots(payload.busySlots)}${styleExamplesSection}${currentDraftSection}${userNotesSection}`;
}

/** Compose-mode counterpart to buildUserMessage() — there's no received email to quote, so
 * this is built from just the recipient, busy slots, style examples, current draft, and the
 * user's own instructions (which carry the entire content of what to write, not just an
 * override on top of an original email). */
export function buildComposeUserMessage(payload: GenerateDraftBody): string {
  const sections: string[] = [];
  if (payload.to?.trim()) sections.push(`宛先: ${payload.to.trim()}`);
  if (payload.busySlots && payload.busySlots.length > 0) {
    sections.push(`予定が入っている日時(候補日を提案する場合はこれらを避ける):\n${formatBusySlots(payload.busySlots)}`);
  }
  if (payload.styleExamples && payload.styleExamples.length > 0) {
    sections.push(
      `過去にユーザーが実際に送信したメールの例(口調・言葉遣い・文の長さなど書き方の傾向をつかむための参考。内容やこの例文の文言そのものを今回のメールに流用しないこと):\n${payload.styleExamples
        .map((ex, i) => `【例${i + 1}】\n${ex.trim()}`)
        .join("\n\n")}`,
    );
  }
  if (payload.currentDraft?.trim()) {
    sections.push(
      `現在の下書き本文(直前にAIが生成し、ユーザーが今画面で見ているもの。ユーザーからの指示内の「これ」「上記」「この日付」等の指示語は、この下書き本文中の該当箇所を指している可能性が高い):\n${payload.currentDraft.trim()}`,
    );
  }
  if (payload.userNotes?.trim()) {
    sections.push(`ユーザーからの指示(このメールで伝えたい内容。必ず反映すること):\n${payload.userNotes.trim()}`);
  }
  return sections.join("\n\n");
}

/** 呼び出し側が固定で足す挨拶(「お世話になっております」)・名乗り(「船田です」)と
 * 同じものを、システムプロンプトの指示に反してモデルが本文にも書いてしまった時の取り除き。
 *
 * 以前は本文の先頭だけを見ていたため、
 *   ご連絡いただきありがとうございます。
 *   船田です。            ← 2つ目の名乗り
 * のように、お礼の次の行で改めて名乗るパターンを取りこぼし、画面上では
 * 「お世話になっております。船田です。」が2回続いて見えていた(2026-08-24に発生)。
 *
 * そこで、挨拶・名乗りの決まり文句だけで出来ている行は、本文のどこにあっても落とす。
 * 要件部分の本文にこの1行だけが単独で現れることは無いので、消しすぎる心配はない。
 * 決まり文句と他の文が同じ行に入っている場合(「お世話になっております。ご連絡ありがとう
 * ございます。」)は、決まり文句の側だけを取り除いて残りは活かす。 */
const LEADING_BOILERPLATE =
  /^(?:(?:いつも|平素より|平素は|大変)?(?:大変)?お世話になって(?:おります|います)[。.]|お世話になります[。.]|(?:.{0,14}の)?船田(?:です|でございます)[。.])\s*/;

/** 行頭に並んでいる決まり文句だけを、無くなるまで繰り返し落とす。行の途中は触らない —
 * 「当日はお世話になります。」のような、要件の一部として書かれた一文まで削ると、
 * 「当日は」だけが残って文章が壊れてしまうため。 */
function stripLeadingBoilerplate(line: string): string {
  let rest = line.trim();
  for (;;) {
    const next = rest.replace(LEADING_BOILERPLATE, "").trim();
    if (next === rest) return rest;
    rest = next;
  }
}

export function stripKnownGreetingAndClosing(body: string): string {
  const kept = body
    .split("\n")
    .map((line) => ({ original: line.trim(), cleaned: stripLeadingBoilerplate(line) }))
    // 決まり文句しか無かった行は落とす。元から空だった行(段落の区切り)はそのまま残す。
    .filter((line) => line.cleaned !== "" || line.original === "")
    .map((line) => line.cleaned)
    .join("\n");
  return kept.replace(/\s*以上、?よろしくお願い(いたします|します)[。.]?\s*$/, "").trim();
}

const REPLY_SYSTEM_PROMPT = `あなたはユーザーの代わりにメール返信を検討するアシスタントです。必ず以下の構成で出力してください(${BODY_MARKER}内で日程を提案しない場合は${CANDIDATES_MARKER}セクション自体を省略してよい)。

${POINTS_MARKER}
返信で押さえておくべき点を2〜4個、箇条書きで(各行「- 」から始める)。相手の質問・依頼への回答や、使うとよい言葉・フレーズなど。

${CANDIDATES_MARKER}
${BODY_MARKER}内で日程(面接・打ち合わせ等の候補日)を提案する場合のみ、提案した日付を1行1件、
"YYYY-MM-DD|開始HH:mm|終了HH:mm" の形式で出力する(時刻未定なら2〜3列目は空でよい。例: 2026-08-20|14:00|15:00 や 2026-08-21|| )。
受信メールの本文に「8月17日以降で」「◯日より後で」のような下限の指定がある場合、それより前の日付は絶対に提案しない。

${EARLIEST_DATE_MARKER}
受信メールの本文中に、日程調整についての明示的な下限(「◯月◯日以降で」「◯日より後で」など)が書かれている場合のみ、
該当する最も早い日付をYYYY-MM-DD形式で1行だけ出力する。存在しない制約を推測して作らないこと。書かれていなければ
このセクション自体を省略する(候補日を出す出さないに関わらず、下限の記載があれば必ず出力する)。

${SUBJECT_MARKER}
この返信メールの件名を1行で(「Re:」は付けない)。元の件名をそのまま繰り返すのではなく、返信の要件が一目で伝わる件名を考えること。話題が元のメールと変わっていなければ、元の件名の要点を踏襲してよい。

${BODY_MARKER}
受信メールへの返信文の、要件部分の本文のみ(そのメールと同じ言語)。件名は含めない。
冒頭の挨拶(「お世話になっております」等)・名乗り(「船田です」等)・結びの言葉(「よろしくお願いします」等)は
呼び出し側で別途付け足すので、${BODY_MARKER}にはそれらを一切含めず、要件そのものから書き始めること。
お礼(「ご連絡いただきありがとうございます」等)から書き始めるのは構わないが、そのあとに改めて名乗らないこと。
名乗りは冒頭に限らず本文中のどこにも書いてはならない(お礼の直後の行に「船田です。」と書くのも不可)。
日程を提案する場合、本文中でその日付は必ず「M/D(曜) HH:mm〜HH:mm」の形式で書き(例: 8/20(木) 14:00〜15:00、時刻未定なら「8/20(木)」のみ)、
${CANDIDATES_MARKER}に書いた内容と表記を完全に一致させること(この表記が一致しないと、ユーザーが日付を後から変更できなくなる)。

共通ルール:
- 「過去にユーザーが実際に送信した返信の例」が渡されている場合、そこから文体・口調(敬語の丁寧さの度合い、一人称、語尾、文の長さ、段落の区切り方、絵文字や記号の使い方の有無など)の傾向を読み取り、今回の返信もできるだけ同じ書き方になるようにすること。ただし例文に書かれている具体的な内容・話題・固有名詞は今回のメールと無関係なので、そのまま流用したり混ぜたりしてはならない(参考にするのは書き方だけ)
- 「現在の下書き本文」が渡されている場合、それは前回このAIが生成し、ユーザーが今画面で見ている内容である。「ユーザーからの追加指示」中の「これ」「それ」「上記」「この日付」のような指示語は、受信メールではなく現在の下書き本文中の該当箇所を指しているものとして解釈すること
- 簡潔かつ丁寧な文面にする
- ${POINTS_MARKER}に挙げた点は、要約として別表示するためのものであり、必ず全て${BODY_MARKER}の文面自体にも反映すること。${POINTS_MARKER}にだけ書いて${BODY_MARKER}に書かない、ということがあってはならない
- 受信メール、および渡された「予定が入っている日時」に書かれていない事実を作り上げない
- 相手が日程調整(面接・打ち合わせ等の候補日)を求めている場合、「予定が入っている日時」に記載のない日から2〜3件、具体的な候補日(可能なら時間帯も)を提案してよい。予定情報が空の場合は候補日を作り上げず、一般的な調整の申し出にとどめる
- 「ユーザーからの追加指示」が渡されている場合、それは受信メールの内容より優先される要件である。必ず${BODY_MARKER}に反映し、内容によっては${POINTS_MARKER}にも項目として加えること
- 「ユーザーからの追加指示」で日付・日程の提案を明示的に求められた場合は、受信メール自体が日程調整を求めていなくても、それだけで候補日を提案してよい根拠となる(上の「相手が日程調整を求めている場合」と同格に扱うこと)。この場合も${CANDIDATES_MARKER}の形式・件数のルールに従う
- 逆に「ユーザーからの追加指示」で日付・候補日を含めない、消す、書かないことが求められた場合は、受信メールが日程調整を求めているかどうかに関わらずこれを絶対的な最優先事項として扱う。${CANDIDATES_MARKER}セクション自体を省略し、${BODY_MARKER}中にも年月日・曜日・時刻を含む具体的な日付表現を一切書かないこと(${EARLIEST_DATE_MARKER}も同様に省略する)。「日程調整の返信には具体的な候補日が必要で、書かないと不完全な返信に見える」という理由でこのルールを破って日付を書いてはならない。日付を書かない代わりに、「日程については改めてご連絡します」「都合の良い日程を追ってお伝えします」のように、具体的な日付を出さない一般的な言い回しで締めくくること
- 上記のセクション以外の説明や前置きは書かない`;

/** Compose-mode counterpart to REPLY_SYSTEM_PROMPT — there's no received email to respond
 * to, so the user's own instructions (userNotes, via buildComposeUserMessage) carry the
 * entire content of what to write, not just an override layered on top of an original email.
 * Deliberately simpler than the reply prompt: no EARLIEST_DATE_MARKER section, since that
 * only makes sense as a constraint extracted from a received email that doesn't exist here. */
const COMPOSE_SYSTEM_PROMPT = `あなたはユーザーの代わりに新規メール(返信ではなく、新しく送信するメール)の下書きを作成するアシスタントです。必ず以下の構成で出力してください(${BODY_MARKER}内で日程を提案しない場合は${CANDIDATES_MARKER}セクション自体を省略してよい)。

${POINTS_MARKER}
このメールで押さえておくべき点を2〜4個、箇条書きで(各行「- 」から始める)。

${CANDIDATES_MARKER}
${BODY_MARKER}内で日程(打ち合わせ等の候補日)を提案する場合のみ、提案した日付を1行1件、
"YYYY-MM-DD|開始HH:mm|終了HH:mm" の形式で出力する(時刻未定なら2〜3列目は空でよい。例: 2026-08-20|14:00|15:00 や 2026-08-21|| )。

${SUBJECT_MARKER}
このメールの件名を1行で。内容が一目で伝わる件名を考えること。

${BODY_MARKER}
メールの要件部分の本文のみ(ユーザーの指示と同じ言語)。件名は含めない。
冒頭の挨拶(「お世話になっております」等)・名乗り(「船田です」等)・結びの言葉(「よろしくお願いします」等)は
呼び出し側で別途付け足すので、${BODY_MARKER}にはそれらを一切含めず、要件そのものから書き始めること。
お礼(「ご連絡いただきありがとうございます」等)から書き始めるのは構わないが、そのあとに改めて名乗らないこと。
名乗りは冒頭に限らず本文中のどこにも書いてはならない(お礼の直後の行に「船田です。」と書くのも不可)。
日程を提案する場合、本文中でその日付は必ず「M/D(曜) HH:mm〜HH:mm」の形式で書き(例: 8/20(木) 14:00〜15:00、時刻未定なら「8/20(木)」のみ)、
${CANDIDATES_MARKER}に書いた内容と表記を完全に一致させること(この表記が一致しないと、ユーザーが日付を後から変更できなくなる)。

共通ルール:
- 「過去にユーザーが実際に送信したメールの例」が渡されている場合、そこから文体・口調(敬語の丁寧さの度合い、一人称、語尾、文の長さ、段落の区切り方、絵文字や記号の使い方の有無など)の傾向を読み取り、今回のメールもできるだけ同じ書き方になるようにすること。ただし例文に書かれている具体的な内容・話題・固有名詞は今回のメールと無関係なので、そのまま流用したり混ぜたりしてはならない(参考にするのは書き方だけ)
- 「現在の下書き本文」が渡されている場合、それは前回このAIが生成し、ユーザーが今画面で見ている内容である。「ユーザーからの指示」中の「これ」「それ」「上記」「この日付」のような指示語は、この下書き本文中の該当箇所を指しているものとして解釈すること
- 簡潔かつ丁寧な文面にする
- ${POINTS_MARKER}に挙げた点は、要約として別表示するためのものであり、必ず全て${BODY_MARKER}の文面自体にも反映すること。${POINTS_MARKER}にだけ書いて${BODY_MARKER}に書かない、ということがあってはならない
- 「ユーザーからの指示」に書かれていない事実を作り上げない。指示に書かれた内容を過不足なく${BODY_MARKER}に反映すること
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
  // Reply mode needs the received email's from/subject/body together; compose mode (no
  // thread to reply within) needs a recipient and something to say instead.
  const isReply = !!(payload.from && payload.subject && payload.body);
  if (!isReply) {
    if (!payload.to?.trim()) {
      return jsonResponse(400, { error: "宛先を入力してください" });
    }
    if (!payload.userNotes?.trim()) {
      return jsonResponse(400, { error: "メールに書きたい内容を入力してください" });
    }
  }

  const userMessage = isReply ? buildUserMessage(payload) : buildComposeUserMessage(payload);

  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      // 1024だと[ポイント]/[候補日]/[件名]等の前置セクションだけで使い切り、[本文]に
      // 辿り着く前に打ち切られることがあった(userNotesで要望が増えるほど起きやすい)。
      // 打ち切られると本文が空のまま200を返してしまい、ユーザーには「入力した内容が
      // 反映されないどころか文章ごと消えた」ように見える無言の失敗になっていた。
      max_tokens: 2048,
      system: isReply ? REPLY_SYSTEM_PROMPT : COMPOSE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonResponse(res.status, { error: `Anthropic API error: ${text}` });
  }

  const data = (await res.json()) as { content: { type: string; text?: string }[]; stop_reason?: string };
  const generated = data.content.find((block) => block.type === "text")?.text ?? "";
  const { keyPoints, candidateDates, earliestDate, subject, body: generatedBody } = parseModelOutput(generated);
  const cleanedBody = stripKnownGreetingAndClosing(generatedBody);
  if (!cleanedBody) {
    // 2048に上げても万一起きた場合、空の下書きを黙って保存させるより、はっきり
    // 失敗として返してユーザーに再試行してもらう方がまだよい。
    return jsonResponse(502, {
      error:
        data.stop_reason === "max_tokens"
          ? "生成が長くなりすぎて本文が完成しませんでした。もう一度お試しください"
          : "AIから本文を取得できませんでした。もう一度お試しください",
    });
  }
  const draft = `お世話になっております。\n船田です。\n\n${cleanedBody}\n\n以上、よろしくお願いします。`;
  const candidateDatesWithLabel = candidateDates.map((c) => ({ ...c, label: formatCandidateLabel(c) }));
  // 返信モードでモデルが件名を返さなかった場合は元の件名を踏襲する(候補日と違い、件名は常に
  // 必要なフィールドのため)。元の件名が既に"Re:"始まりだったり、モデルが指示に反して自分で
  // 付けてしまった場合の二重付与を防ぐ。作成モードには踏襲元の件名がないため、モデルの
  // 出力をそのまま使う(空ならユーザーが画面上で自分で入力する)。
  let finalSubject = subject;
  if (isReply) {
    const rawSubject = subject || payload.subject!;
    finalSubject = rawSubject.startsWith("Re:") ? rawSubject : `Re: ${rawSubject}`;
  }

  return jsonResponse(200, { draft, keyPoints, candidateDates: candidateDatesWithLabel, earliestDate, subject: finalSubject });
};
