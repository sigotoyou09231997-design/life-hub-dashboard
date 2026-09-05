/**
 * 旅行のしおりの共有(supabase/sql/023_trip_shares.sql)。
 *
 * 他の旅行データと違って、共有の入り切りは**端末内(Dexie)を経由しない**。
 * 旅行詳細から Supabase の trip_shares を直接読み書きし、共有をやめる＝行を消す。
 * こうしておくと「OFFにしたのに、まだ送信できていない端末の都合でしばらく見られたまま」
 * が起きない(2026-09-04の指示「OFFにしたら既存のリンクは即座に無効」)。
 * 代わりに、共有の入り切りはオンラインの時だけできる。
 *
 * 見る側(ログインしていない人)は fetchSharedTrip() だけを使う。こちらは
 * supabase-js を読み込まず、公開鍵(anon key)を付けた素の fetch で関数を呼ぶ —
 * 共有ページはログインもDexieも要らないので、そのぶんを読み込ませない。
 */
import { auth, getSupabaseConfig, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";

export interface TripShare {
  tripId: string;
  token: string;
  /** 費用を共有に含めるか。日記は設定に関わらず常に含めない。 */
  includeExpenses: boolean;
}

export interface SharedTripInfo {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  memo?: string;
  status: string;
}

export interface SharedScheduleItem {
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  title: string;
  location?: string;
  memo?: string;
  type: string;
}

export interface SharedPackingItem {
  title: string;
  category: string;
  checked: boolean;
}

export interface SharedRoutePlace {
  name: string;
  address: string;
  sortOrder: number;
  date?: string;
  memo?: string;
  visited: boolean;
}

export interface SharedExpense {
  title: string;
  amount: number;
  category: string;
  paidDate?: string;
  paid: boolean;
  memo?: string;
  /** 現地通貨で払った場合だけ付く(021の内訳)。 */
  currency?: string;
  originalAmount?: number;
}

export interface SharedTrip {
  trip: SharedTripInfo;
  includeExpenses: boolean;
  schedule: SharedScheduleItem[];
  packing: SharedPackingItem[];
  route: SharedRoutePlace[];
  expenses: SharedExpense[];
}

/** 合鍵。UUIDを2つ繋いだ64文字(乱数256bit)。URLに入るので記号は落とす。 */
export function newShareToken(): string {
  const half = () => crypto.randomUUID().replace(/-/g, "");
  return `${half()}${half()}`;
}

/** 共有リンク。開いた人はログインせずにこのURLだけで中身を見る。 */
export function shareUrlFor(token: string, origin: string = window.location.origin): string {
  return `${origin}/share/trip/${token}`;
}

/**
 * 関数(get_shared_trip)が返した JSON を、画面が使う形にそろえる。
 * 共有が終わっている・token が違う・旅行そのものが消えている場合は null。
 * ネットワークを触らないので、ここだけテストで確かめられる。
 */
export function parseSharedTrip(raw: unknown): SharedTrip | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const trip = value.trip;
  if (!trip || typeof trip !== "object") return null;
  const info = trip as Record<string, unknown>;
  if (typeof info.name !== "string" || typeof info.startDate !== "string") return null;
  const list = <T>(key: string): T[] => (Array.isArray(value[key]) ? (value[key] as T[]) : []);
  return {
    trip: {
      name: info.name,
      destination: typeof info.destination === "string" ? info.destination : "",
      startDate: info.startDate,
      endDate: typeof info.endDate === "string" ? info.endDate : info.startDate,
      memo: typeof info.memo === "string" ? info.memo : undefined,
      status: typeof info.status === "string" ? info.status : "planning",
    },
    includeExpenses: value.includeExpenses === true,
    schedule: list<SharedScheduleItem>("schedule"),
    packing: list<SharedPackingItem>("packing"),
    route: list<SharedRoutePlace>("route"),
    // 費用は共有に含めない設定なら、サーバー側で空になって返る。念のためこちらでも落とす。
    expenses: value.includeExpenses === true ? list<SharedExpense>("expenses") : [],
  };
}

/**
 * 共有リンクの中身を取りに行く。見つからない(共有が終わっている)場合は null。
 * ログインしていない人が呼ぶので、公開鍵だけを付けて関数を叩く。
 */
export async function fetchSharedTrip(token: string): Promise<SharedTrip | null> {
  if (!isSupabaseConfigured) return null;
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/get_shared_trip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ p_token: token }),
  });
  if (!response.ok) throw new Error(`get_shared_trip failed: ${response.status}`);
  return parseSharedTrip(await response.json());
}

function rowToShare(row: { trip_id: string; token: string; include_expenses: boolean }): TripShare {
  return { tripId: row.trip_id, token: row.token, includeExpenses: row.include_expenses };
}

/** いまこの旅行が共有されているか。共有していなければ null。 */
export async function loadTripShare(tripId: string): Promise<TripShare | null> {
  const client = await getSupabaseDataClient();
  const { data, error } = await client
    .from("trip_shares")
    .select("trip_id, token, include_expenses")
    .eq("trip_id", tripId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToShare(data) : null;
}

/**
 * 共有を始める。すでに共有していた場合も、古い行を消してから新しい合鍵で入れ直す —
 * 一度やめたリンクは二度と使わない(2026-09-04の指示)。
 */
export async function startTripShare(tripId: string, includeExpenses: boolean): Promise<TripShare> {
  const userId = (await auth.getSession()).data.session?.user.id;
  if (!userId) throw new Error("ログインしていないため共有できません");
  const client = await getSupabaseDataClient();
  await endTripShare(tripId);
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    trip_id: tripId,
    token: newShareToken(),
    include_expenses: includeExpenses,
  };
  const { error } = await client.from("trip_shares").insert(row);
  if (error) throw new Error(error.message);
  return rowToShare(row);
}

/** 共有したまま、費用を含めるかどうかだけ切り替える(リンクはそのまま)。 */
export async function setTripShareExpenses(tripId: string, includeExpenses: boolean): Promise<void> {
  const client = await getSupabaseDataClient();
  const { error } = await client
    .from("trip_shares")
    .update({ include_expenses: includeExpenses, updated_at: new Date().toISOString() })
    .eq("trip_id", tripId);
  if (error) throw new Error(error.message);
}

/** 共有をやめる。行ごと消すので、配ったリンクはこの瞬間から見られなくなる。 */
export async function endTripShare(tripId: string): Promise<void> {
  const client = await getSupabaseDataClient();
  const { error } = await client.from("trip_shares").delete().eq("trip_id", tripId);
  if (error) throw new Error(error.message);
}
