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
  return items.map((item) => ({ ...item, checked: true, withExpense: item.amount != null }));
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
  const push = (name: string | undefined, address: string | undefined, memo: string | undefined) => {
    if (!name?.trim() || !address?.trim()) return;
    const key = routeKey(address);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ checked: true, name: name.trim(), address: address.trim(), memo: memo?.trim() || undefined });
  };
  for (const item of items) {
    if (item.type === "transport") {
      push(item.location, item.location, item.title);
      push(item.endLocation, item.endLocation, item.title);
      continue;
    }
    push(item.title, item.location, item.memo);
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
