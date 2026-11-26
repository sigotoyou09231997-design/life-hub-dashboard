/**
 * 予定の「場所」「メモ」「名前」から、オンライン会議(Zoom・Google Meet・Teams・Webex・Whereby)の
 * 参加リンクを探す(2026-11-26 本人「面接の URL が分かっている時は、ワンタップで開けるボタンにしてほしい」)。
 *
 * 会議サービスのリンクだけを拾う。ほかの URL(会社のページ・地図など)まで「参加」ボタンにすると、
 * 押したら面接ではない所が開く、という取り違えが起きるため。
 * 「https://」が無い書き方(meet.google.com/abc-defg-hij)も拾う。メモに手で貼ると落ちていることがあるため。
 */

export interface MeetingLink {
  /** 開く URL(https:// から始まる形にそろえてある)。 */
  url: string;
  /** ボタンに出すサービス名。「Zoom で参加」の Zoom。 */
  service: string;
}

const SERVICES: { host: RegExp; name: string }[] = [
  { host: /(^|\.)zoom\.(us|com)$/i, name: "Zoom" },
  { host: /^meet\.google\.com$/i, name: "Meet" },
  { host: /^teams\.(microsoft|live)\.com$/i, name: "Teams" },
  { host: /(^|\.)webex\.com$/i, name: "Webex" },
  { host: /(^|\.)whereby\.com$/i, name: "Whereby" },
];

/**
 * 候補の切り出し。ホストの前に英数字やドットが続いている物(evilzoom.us など)は拾わない。
 * パスが1文字も無い物(「zoom.us で」のような、ただの言及)も拾わない。
 * 日本語の文中に置かれることが多いので、全角の括弧・句読点・空白で URL を切る。
 */
const CANDIDATE =
  /(?<![a-z0-9.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:zoom\.(?:us|com)|meet\.google\.com|teams\.(?:microsoft|live)\.com|webex\.com|whereby\.com)\/[^\s<>"'「」『』（）【】、。，．　]+/gi;

/** 文の終わりに付いてきた記号は URL に含めない(「…/j/123。」「(…/abc)」)。 */
const TRAILING = /[.,;:!?)\]}>]+$/;

function toMeetingLink(raw: string): MeetingLink | null {
  const trimmed = raw.replace(TRAILING, "");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.pathname === "/" && !parsed.search) return null;
  const service = SERVICES.find((s) => s.host.test(parsed.hostname));
  if (!service) return null;
  return { url: parsed.href, service: service.name };
}

/** 渡した文を前から順に見て、最初に見つかった会議のリンクを返す。無ければ null。 */
export function findMeetingLink(...texts: (string | null | undefined)[]): MeetingLink | null {
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(CANDIDATE)) {
      const link = toMeetingLink(match[0]);
      if (link) return link;
    }
  }
  return null;
}

/** 予定から探す。場所 → メモ → 名前の順(場所に貼るのがいちばん多いため)。 */
export function eventMeetingLink(event: { location?: string | null; memo?: string | null; title?: string | null }): MeetingLink | null {
  return findMeetingLink(event.location, event.memo, event.title);
}
