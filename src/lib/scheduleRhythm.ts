/**
 * 旅行の日程で「生活の区切り」にあたる予定か(UI/UX 調査メモ 第6弾 D-4、2026-10-16)。
 *
 * 「起床」「準備」「自宅出発」のような行は、観光地や宿と同じ大きさで並ぶと、1日のどこへ行くのかが
 * 埋もれる。題名の文字列で簡単に見分けて、一覧では一段小さく・薄く出す(データは変えない)。
 * 厳密でなくてよい、という依頼なので、題名が区切りの言葉そのもの(か、その後ろに括弧の補足が付くだけ)で、
 * 場所が無いか「自宅」の時だけ。「朝食」でも店の場所が入っていれば、ふつうの予定として出す。
 */
const MARKERS = [
  "起床",
  "起きる",
  "準備",
  "支度",
  "身支度",
  "出発",
  "自宅出発",
  "自宅を出発",
  "家を出る",
  "帰宅",
  "自宅着",
  "就寝",
  "朝食",
  "朝ごはん",
  "朝ご飯",
  "荷造り",
  "解散",
];
const MARKER_RE = new RegExp(`^(?:${MARKERS.join("|")})(?:\\s*[(（].*)?$`);
const HOME_RE = /^(自宅|家|実家)$/;

export function isLifeMarker(item: { title: string; location?: string | null }): boolean {
  const title = item.title.trim();
  if (!MARKER_RE.test(title)) return false;
  const location = (item.location ?? "").trim();
  return location === "" || HOME_RE.test(location);
}
