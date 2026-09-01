import type {
  CalendarEvent,
  Task,
  Trip,
  TripExpense,
  TripExpenseCategory,
  TripRoutePlace,
  TripScheduleItem,
  TripScheduleType,
} from "../types";

/** メールから読み取った日程1件。netlify/functions/extractTripPlan.ts の返す形と揃える。 */
export interface ExtractedTripItem {
  date: string;
  startTime?: string;
  /** 終了時刻(移動なら到着時刻)。メールから読み取れた時だけ。 */
  endTime?: string;
  title: string;
  location?: string;
  /** 移動の到着地(駅・空港)。出発地は location に入る。ルートに2地点として起こすのに使う。
   * 古いサーバーからは返ってこないので、無いことも前提にする。 */
  endLocation?: string;
  memo?: string;
  type: TripScheduleType;
  /** その項目の代金(円)。メールに書かれていた時だけ。 */
  amount?: number;
}

/** 取り込み画面で1行ごとに持つ状態。読み取った内容はそのまま保存せず、必ず本人が
 * 確認して直せるようにする — AIの読み違いをそのまま日程表に入れないため。 */
export interface TripImportRow extends ExtractedTripItem {
  checked: boolean;
  /** 旅行の費用にも積むか。金額が読み取れた時だけ既定で入り、外せる。 */
  withExpense: boolean;
}

export function toImportRows(items: ExtractedTripItem[]): TripImportRow[] {
  // 金額が読み取れたものは、費用にも入れる前提にしておく(要らなければ外せる)。
  return mergeDuplicateItems(items).map((item) => ({ ...item, checked: true, withExpense: item.amount != null }));
}

/** 見出しから空白と記号を落とす。「株式会社Widsley 一次面接」と「株式会社Widsley　面接」を
 * 同じものとして見比べるため。 */
function titleKey(title: string): string {
  return title.replace(/[\s\u3000・:：\-−–—【】\[\]()（）]/g, "");
}

/** 同じ予定が粒度違いで2件返ってくることがあるので、1件にまとめる。
 *
 * 件名の「株式会社Widsley 面接」と、本文の「株式会社Widsley 一次面接 12:15〜12:45」のように、
 * AIが同じ用件を別々の項目として返すことがある。そのまま並べると、どちらを入れればいいのか
 * 分からず、両方入れると同じ予定が2件できてしまう(2026-09-01)。
 *
 * まとめるのは、日付が同じで・時刻が食い違っておらず(片方に時刻が無いのは食い違いではない)・
 * どちらかの見出しがもう一方を含んでいる場合だけ。日程調整メールの候補日時のように、
 * 同じ日で時刻が違うものは別々に残す — 本人が選ぶためのものなので、勝手にまとめない。 */
export function mergeDuplicateItems(items: ExtractedTripItem[]): ExtractedTripItem[] {
  const kept: ExtractedTripItem[] = [];
  for (const item of items) {
    const index = kept.findIndex((other) => isSameAppointment(other, item));
    if (index < 0) {
      kept.push(item);
      continue;
    }
    kept[index] = mergeItems(kept[index], item);
  }
  return kept;
}

function isSameAppointment(a: ExtractedTripItem, b: ExtractedTripItem): boolean {
  if (a.date !== b.date) return false;
  if (a.startTime && b.startTime && a.startTime !== b.startTime) return false;
  const [keyA, keyB] = [titleKey(a.title), titleKey(b.title)];
  // 短すぎる見出しは、たまたま文字が並んだだけで同じ扱いにしてしまうので見比べない。
  if (keyA.length < 3 || keyB.length < 3) return false;
  const [shorter, longer] = keyA.length <= keyB.length ? [keyA, keyB] : [keyB, keyA];
  // 詳しい方に、短い方の文字が同じ順で入っているかを見る。「株式会社Widsley面接」は
  // 「株式会社Widsley一次面接」の間に「一次」が挟まっているだけなので、
  // 単純な部分一致では同じものだと分からない。
  return isSubsequence(shorter, longer);
}

/** short の文字が、同じ順番で long の中に現れるか。 */
function isSubsequence(short: string, long: string): boolean {
  let index = 0;
  for (const char of long) {
    if (char === short[index]) index++;
    if (index === short.length) return true;
  }
  return index === short.length;
}

/** 2件を1件にする。どちらか片方にしか無い情報は残し、見出しは詳しい方(長い方)を採る。 */
function mergeItems(a: ExtractedTripItem, b: ExtractedTripItem): ExtractedTripItem {
  const longer = (x?: string, y?: string) => ((y?.length ?? 0) > (x?.length ?? 0) ? y : x) || undefined;
  return {
    date: a.date,
    title: longer(a.title, b.title) ?? a.title,
    startTime: a.startTime ?? b.startTime,
    endTime: a.endTime ?? b.endTime,
    location: longer(a.location, b.location),
    endLocation: longer(a.endLocation, b.endLocation),
    memo: longer(a.memo, b.memo),
    // 種類は、どちらかが「その他」以外ならそちらを採る(片方だけが用件を読み取れている)。
    type: a.type !== "other" ? a.type : b.type,
    amount: a.amount ?? b.amount,
  };
}

/** どの旅行に入れるかの初期値を決める。
 *
 * 読み取った最初の日付を含む旅行があればそれ。無ければ、その日付にいちばん近い旅行。
 * 旅行が1つも無ければ undefined(画面側で「先に旅行を作ってください」と案内する)。
 * 日付から当たりを付けておかないと、旅行が増えるほど毎回選び直すことになる。 */
export function pickDefaultTripId(trips: Trip[], items: ExtractedTripItem[]): string | undefined {
  if (trips.length === 0) return undefined;
  const target = items[0]?.date;
  if (!target) return trips[0].id;

  const covering = trips.find((trip) => trip.startDate <= target && target <= trip.endDate);
  if (covering) return covering.id;

  const nearest = [...trips].sort((a, b) => distanceInDays(a, target) - distanceInDays(b, target))[0];
  return nearest.id;
}

function distanceInDays(trip: Trip, date: string): number {
  const day = Date.parse(`${date}T00:00:00`);
  const start = Date.parse(`${trip.startDate}T00:00:00`);
  const end = Date.parse(`${trip.endDate}T00:00:00`);
  if (day < start) return (start - day) / 86_400_000;
  if (day > end) return (day - end) / 86_400_000;
  return 0;
}

/** 旅行の期間から外れている日程。保存はできるが、日程表の日付タブには出てこないので
 * 気付けるように印を出す(旅行の期間を延ばすか、日付を直してもらう)。 */
export function isOutsideTrip(trip: Trip | undefined, date: string): boolean {
  if (!trip) return false;
  return date < trip.startDate || date > trip.endDate;
}

/** 入れ先を選ぶ一覧の並び。新しい旅行ほど上。
 *
 * 並べ替えをここ(JS側)でやるのは、tripsテーブルに索引が id しか無いため
 * (src/db/schema.ts の TABLE_SCHEMAS)。db.trips.orderBy("startDate") と書くと
 * Dexieが例外を投げ、useLiveQuery 経由で描画時に飛んでメール画面ごと落ちる
 * (2026-08-25 の不具合)。他の画面もすべて toArray() で読んでいる。 */
export function sortTripsForPicker(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/** 読み取った内容をどこへ入れるか。保存の作り分けと、入れ終わった知らせの文言に使う。 */
export type PlanDestination = "trip" | "route" | "event" | "task";

export const PLAN_DESTINATIONS: { value: PlanDestination; label: string }[] = [
  { value: "trip", label: "旅行の日程" },
  { value: "route", label: "旅行のルート" },
  { value: "event", label: "予定" },
  { value: "task", label: "タスク" },
];

/** 入れ先の名前。知らせの文とスイッチの見出しに使う。 */
export function destinationLabel(destination: PlanDestination): string {
  return PLAN_DESTINATIONS.find((d) => d.value === destination)?.label ?? "";
}

/** 入れ先を並べる時の順。まとめて入れる時の保存順・表示順をこれで揃える。 */
export function sortDestinations(destinations: PlanDestination[]): PlanDestination[] {
  return PLAN_DESTINATIONS.map((d) => d.value).filter((value) => destinations.includes(value));
}

/** いま開いているタブ以外の入れ先。「ほかにも入れる」のスイッチに並べる。 */
export function otherDestinations(main: PlanDestination): PlanDestination[] {
  return PLAN_DESTINATIONS.map((d) => d.value).filter((value) => value !== main);
}

/** 入れ先ごとの件数。 */
export interface DestinationCount {
  destination: PlanDestination;
  count: number;
}

/** 入れる前の内訳(「旅行の日程 2件・予定 1件」)。0件の入れ先は書かない。 */
export function describeCounts(entries: DestinationCount[]): string {
  return entries
    .filter((entry) => entry.count > 0)
    .map((entry) => `${destinationLabel(entry.destination)} ${entry.count}件`)
    .join("・");
}

/** 入れ終わった知らせ(「旅行の日程に2件、予定に1件入れました」)。 */
export function describeSaved(entries: DestinationCount[]): string {
  const parts = entries
    .filter((entry) => entry.count > 0)
    .map((entry) => `${destinationLabel(entry.destination)}に${entry.count}件`);
  return `${parts.join("、")}入れました`;
}

/** 画面の上段のタブ。日程とルートは「旅行計画」1つにまとめ、その中で選ばせる —
 * 4つ横並びだと、旅行に入れるものとそうでないものが同じ重さに見えるため
 * (アプリの中の呼び名も /trips = 「旅行計画」で揃えている)。 */
export type PlanGroup = "trip" | "event" | "task";

export const PLAN_GROUPS: { value: PlanGroup; label: string }[] = [
  { value: "trip", label: "旅行計画" },
  { value: "event", label: "予定" },
  { value: "task", label: "タスク" },
];

/** 「旅行計画」を選んだ時の、その中の入れ先。 */
export type TripSection = "trip" | "route";

export const TRIP_SECTIONS: { value: TripSection; label: string }[] = [
  { value: "trip", label: "日程" },
  { value: "route", label: "ルート" },
];

/** 上段のタブと、旅行計画の中の選択から、実際の入れ先を決める。 */
export function toDestination(group: PlanGroup, section: TripSection): PlanDestination {
  return group === "trip" ? section : group;
}

/** 入れ先の旅行を選ぶ必要があるか。日程とルートは旅行にぶら下がるが、予定とタスクは
 * 旅行と関係なく入れられる。 */
export function needsTrip(destination: PlanDestination): boolean {
  return destination === "trip" || destination === "route";
}

/** ルートに入れる場所1件。日程と違って日付も時刻も持たず、名前と場所だけで足りる。 */
export interface RouteImportRow {
  checked: boolean;
  name: string;
  /** 地図に渡す文字列。空では保存できない(TripRoutePlace.address と同じ決まり)。 */
  address: string;
  memo?: string;
  /** 何日目の場所か。メールの日程から持ち越して、ルート画面の日にち切り替えで
   * すぐ絞れるようにする。 */
  date?: string;
}

/** 読み取った日程を、ルートに置ける「場所」に起こす。
 *
 * 移動(新幹線・飛行機)は出発地と到着地の2地点に分ける — 「東京→新函館北斗 はやぶさ13号」は
 * 区間の名前であって地図に置ける場所ではないので、駅名そのものを場所の名前にし、どの移動から
 * 来たかはメモに残す。宿や観光は、日程のタイトルを名前・場所を住所にする(日程の場所を
 * つついてルートに起こす時=TripDetailPage の onLocationTap と同じ組み合わせ)。
 *
 * 同じ場所は1件にまとめる。往復のメールは「東京→新函館北斗」「新函館北斗→東京」となり、
 * そのままでは同じ駅が2度ずつ並ぶため。 */
export function toRouteImportRows(items: ExtractedTripItem[]): RouteImportRow[] {
  const rows: RouteImportRow[] = [];
  const seen = new Set<string>();
  const push = (name: string | undefined, address: string | undefined, memo: string | undefined, date: string | undefined) => {
    if (!name?.trim() || !address?.trim()) return;
    const key = routeKey(address);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ checked: true, name: name.trim(), address: address.trim(), memo: memo?.trim() || undefined, date });
  };
  for (const item of items) {
    if (item.type === "transport") {
      push(item.location, item.location, item.title, item.date);
      push(item.endLocation, item.endLocation, item.title, item.date);
      continue;
    }
    push(item.title, item.location, item.memo, item.date);
  }
  return rows;
}

/** ルートの場所1件。回る順は、いま入っている場所の後ろに、読み取った順で足す。 */
export function toTripRoutePlaceRecord(row: RouteImportRow, tripId: string, sortOrder: number, now: number): TripRoutePlace {
  return {
    tripId,
    name: row.name.trim(),
    address: row.address.trim(),
    sortOrder,
    date: row.date || undefined,
    memo: row.memo || undefined,
    visited: false,
    createdAt: now,
  };
}

/** 追加する場所に振る、最初の順番。ルート画面の「追加」と同じ決まり(末尾に足す)。 */
export function nextRouteSortOrder(places: { sortOrder: number }[]): number {
  return places.reduce((max, place) => Math.max(max, place.sortOrder), 0) + 1;
}

/** 場所が「同じ」かどうかを見分ける鍵。地図に渡す文字列(住所)で見る — 名前は
 * 「東京駅」「東京」と揺れるが、同じ住所を2度ルートに置く意味はほとんど無いため。 */
export function routeKey(address: string): string {
  return address.trim().toLowerCase();
}

/** その場所が、選んだ旅行のルートに既にあるか。 */
export function isRouteAlreadyRegistered(row: RouteImportRow, existingKeys: Set<string> | undefined): boolean {
  if (!existingKeys) return false;
  return existingKeys.has(routeKey(row.address));
}

/** 旅行の日程の種類を、そのまま費用の分類に読み替える。移動・宿泊・食事・観光は
 * どちらにも同じ名前であるので一対一で対応し、それ以外は「その他」に寄せる。 */
export function toExpenseCategory(type: TripScheduleType): TripExpenseCategory {
  const shared: TripExpenseCategory[] = ["transport", "lodging", "meal", "sightseeing"];
  return shared.includes(type as TripExpenseCategory) ? (type as TripExpenseCategory) : "other";
}

/** 旅行の費用1件。予約確認メールの金額は既に支払い済みのことがほとんどなので、
 * 支払い済みとして置く(旅行画面で後から変えられる)。 */
export function toTripExpenseRecord(row: TripImportRow, tripId: string, now: number): TripExpense {
  return {
    tripId,
    title: row.title.trim(),
    amount: row.amount ?? 0,
    category: toExpenseCategory(row.type),
    paidDate: row.date,
    paid: true,
    memo: row.memo || undefined,
    createdAt: now,
  };
}

/** 旅行の日程1件。 */
export function toTripScheduleRecord(row: TripImportRow, tripId: string, now: number): TripScheduleItem {
  return {
    tripId,
    date: row.date,
    startTime: row.startTime || undefined,
    endTime: row.endTime || undefined,
    title: row.title.trim(),
    location: row.location || undefined,
    memo: row.memo || undefined,
    type: row.type,
    createdAt: now,
  };
}

/** カレンダーの予定1件。時刻が読み取れなかったものは終日にする —
 * 開始時刻が無い予定は通知の起点が無く、時刻ありのまま置くと0:00に見えてしまう。 */
export function toCalendarEventRecord(row: TripImportRow, now: number): CalendarEvent {
  const allDay = !row.startTime;
  return {
    title: row.title.trim(),
    date: row.date,
    allDay,
    startTime: allDay ? undefined : row.startTime,
    // 終日にした予定に終了時刻だけ残ると、時刻の無い予定に「〜13:20」とだけ出て読めない。
    endTime: allDay ? undefined : row.endTime || undefined,
    location: row.location || undefined,
    memo: row.memo || undefined,
    category: "other",
    createdAt: now,
  };
}

/** タスク1件。読み取った日付を期限にする。優先度は本人が後で決められるよう「中」で置く。 */
export function toTaskRecord(row: TripImportRow, now: number): Task {
  return {
    title: row.title.trim(),
    priority: "medium",
    dueDate: row.date,
    dueTime: row.startTime || undefined,
    category: "other",
    completed: false,
    repeat: "none",
    createdAt: now,
  };
}

/** 読み取りの失敗理由を、次にやることまで含めた日本語にする。
 *
 * 「extractTripPlan failed (405)」のような素の文言では何をすればよいか分からない。
 * 405/404 は、端末のアプリだけ先に新しくなって、対応するサーバー側の処理がまだ
 * 届いていない(または更新前のアプリのまま押した)時に返る。 */
export function describePlanImportError(err: unknown): string {
  const status = typeof err === "object" && err !== null ? (err as { status?: number }).status : undefined;
  if (status === 404 || status === 405) {
    return "アプリの更新がこの端末にまだ届いていないようです。アプリを一度閉じて開き直してから、もう一度お試しください";
  }
  if (status === 429) {
    return "AIの利用が混み合っています。少し待ってから、もう一度お試しください";
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/ANTHROPIC_API_KEY/.test(raw)) {
    return "サーバーにAIの接続情報(ANTHROPIC_API_KEY)が設定されていません";
  }
  return raw;
}

/** 「同じ内容」かどうかを見分けるための鍵。日付・時刻・タイトルが揃っていれば同じものとみなす。
 *
 * どのメールから作ったかを行に持たせる方法もあるが、3つのテーブル全部に項目を足すことに
 * なるうえ、手で入れた同じ予定とは結局重複する。内容で見る方が、取り込み元によらず効く。
 *
 * タイトルの前後の空白と時刻の未設定は揃えてから比べる — 見た目が同じものを、空白1つで
 * 別物と判定してしまわないようにするため。 */
export function planKey(date: string, time: string | undefined, title: string): string {
  return `${date}|${time ?? ""}|${title.trim()}`;
}

/** その行が、入れ先に既にあるか。 */
export function isAlreadyRegistered(row: TripImportRow, existingKeys: Set<string> | undefined): boolean {
  if (!existingKeys) return false;
  return existingKeys.has(planKey(row.date, row.startTime, row.title));
}

/** 見た目の違いだけを落としたタイトル。「似ているか」を見るためのもの。
 *
 * planKey は日付・時刻・タイトルが揃って初めて同じとみなすので、しおりのような
 * 時刻の無い文章を読み取ると、手で入れた「鎌倉散歩」と読み取った「🚗 鎌倉散歩」が
 * 別物になって二重に並ぶ。絵文字・記号・空白・全角半角のゆれをここで揃える。 */
export function normalizePlanTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    // 絵文字と、区切りに使われる記号・かっこ。しおりの「🎣 初心者船釣り」「江の島・灯籠」など。
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\s・、。,，.．/／|｜~〜\-–—+＋:：;；()（）[\]「」『』【】"'!！?？♪…]/gu, "")
    .trim();
}

/** 同じ日にある予定。似ているかを見るのに、鍵ではなく中身が要る。 */
export interface ExistingPlan {
  date: string;
  startTime?: string;
  title: string;
}

/** その行と似た予定が、同じ日に既にあるか。あればその予定のタイトルを返す。
 *
 * 完全一致(planKey)は入れさせないが、こちらは**入れられるが既定では外しておく**ための
 * ゆるい判定 — 「鎌倉散歩」と「お迎え・買い出し・鎌倉散歩」のように、片方がもう片方を
 * 含む書き方は同じ予定のことが多い。ただし「移動」「昼食」のような短い言葉は、別の
 * 予定にも普通に出てくるので、含むだけでは同じとみなさない(2文字以下は完全一致のみ)。 */
export function findSimilarPlan(row: { date: string; title: string }, existing: ExistingPlan[] | undefined): string | undefined {
  if (!existing) return undefined;
  const target = normalizePlanTitle(row.title);
  if (!target) return undefined;
  for (const item of existing) {
    if (item.date !== row.date) continue;
    const other = normalizePlanTitle(item.title);
    if (!other) continue;
    if (other === target) return item.title;
    const shorter = target.length <= other.length ? target : other;
    if (shorter.length <= 2) continue;
    if (other.includes(target) || target.includes(other)) return item.title;
  }
  return undefined;
}
