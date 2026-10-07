import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type { Handler } from "@netlify/functions";
import { MAX_ITEMS, deliverTripPlan, normalizeDate, parseItems } from "./receiveTripPlan.js";

/**
 * LIFE HUB の ChatGPT プラグイン用の MCP サーバー(ステートレスな Streamable HTTP・応答は JSON)。
 *
 * ツールは2系統ある:
 * - send_trip_plan: 送信コードで、本人の「受信箱」へ旅程を置く(認証なし。日程には入らず、アプリの確認画面を通す)。
 *   カスタムGPT(2026-12-11に終了)の代わりに、自分用のプラグインで使う。
 * - list_trips / create_trip / add_schedule_items / get_trip_schedule: **ChatGPT から LIFE HUB のアカウントに
 *   ログイン(OAuth)して、旅行と日程を直接作る**(tabiori と同じ形)。ログインは Supabase Auth の OAuth 2.1
 *   サーバーが行い、ここは渡されたアクセストークンを検証して、**その人の権限のまま** Supabase(PostgREST)を呼ぶ。
 *   だから既存の行レベルの制限(自分の行しか読み書きできない)がそのまま効き、強い鍵は持たない。
 *   書いた行は、アプリの同期が自動で拾う(src/lib/sync.ts)。
 *
 * 直接書く系の決まり(読み違いがそのまま日程に入るので、守りを固くしている):
 * - **削除はしない。既存の行を上書きもしない。**足すだけ。
 * - 予定の ID は (旅行・日付・時刻・題名) から決まる値。同じ旅程を2回送っても二重にならず、
 *   本人が消した予定が勝手に戻ることもない(INSERT … ON CONFLICT DO NOTHING)。
 * - 旅行の期間の外の日付は入れない。1回200件まで。金額は受け取らない。
 *
 * 応答はステートレスなので、メッセージの中身とヘッダーだけで答えが決まる。サーバーからの通知は無いので GET は 405。
 *
 * 反対側のフォルダ(api/ ↔ netlify/functions/)の同名ファイルと、中核の部分は完全に同一
 * (scripts/gen-netlify-functions.mjs が api/ から netlify/functions/ を作り直す)。
 * 同じフォルダの receiveTripPlan は、拡張子 .js を付けて import する。package.json が type: module なので、
 * Node の ESM は拡張子の無い相対 import を読み込めず、Vercel 上で関数ごと落ちる(FUNCTION_INVOCATION_FAILED。
 * 2026-10-07 に ./receiveTripPlan と書いて実際に落ちた)。TypeScript と vitest は .js を .ts として解決する。
 */

export const SERVER_INFO = { name: "life-hub-trip-inbox", title: "LIFE HUB 旅行プランナー", version: "2.0.0" };

/** 受け付ける MCP の版。クライアントが挙げた版が無ければ、先頭(いちばん新しい)を返す。 */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const SEND_TRIP_PLAN = "send_trip_plan";
export const LIST_TRIPS = "list_trips";
export const CREATE_TRIP = "create_trip";
export const ADD_SCHEDULE_ITEMS = "add_schedule_items";
export const GET_TRIP_SCHEDULE = "get_trip_schedule";

const ITEM_TYPES = ["transport", "lodging", "meal", "sightseeing", "other"];

/** 公開されている LIFE HUB の URL(OAuth の resource とメタデータの場所の元)。 */
export function publicBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.PUBLIC_BASE_URL || "https://life-hub-dashboard.vercel.app").replace(/\/+$/, "");
}

export const resourceUrl = (baseUrl: string) => `${baseUrl}/api/mcp`;
export const resourceMetadataUrl = (baseUrl: string) => `${baseUrl}/.well-known/oauth-protected-resource/api/mcp`;

/** 日程の項目の入力定義。public/chatgpt/openapi.json の定義と同じ項目(テストが突き合わせる)。 */
const ITEM_SCHEMA = {
  type: "object",
  required: ["date", "title"],
  properties: {
    date: { type: "string", description: "その予定の日。YYYY-MM-DD(年つき)", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    startTime: { type: "string", description: "開始時刻。HH:mm(24時間)。決まっている時だけ。", pattern: "^\\d{1,2}:\\d{2}$" },
    endTime: { type: "string", description: "終了時刻。移動なら到着時刻。HH:mm。決まっている時だけ。", pattern: "^\\d{1,2}:\\d{2}$" },
    title: { type: "string", description: "予定の題名。短く。例: 羽田→高松 JAL443、ホテル出発、昼食 讃岐うどん" },
    location: { type: "string", description: "場所の名前(駅・空港・施設)。移動なら出発地。" },
    endLocation: { type: "string", description: "移動の到着地(駅・空港)。移動のときだけ。" },
    type: {
      type: "string",
      enum: ITEM_TYPES,
      description: "transport=移動, lodging=宿泊・チェックイン/アウト, meal=食事, sightseeing=観光・見学, other=起床・準備・休憩など",
    },
    memo: { type: "string", description: "当日必要な短いメモ。予約番号・持ち物など。なければ省く。" },
  },
};

const RESULT_SCHEMA = {
  type: "object",
  required: ["ok", "message"],
  properties: {
    ok: { type: "boolean", description: "うまくいったか" },
    message: { type: "string", description: "ユーザーに伝える案内" },
  },
};

const NO_AUTH = [{ type: "noauth" }];
const OAUTH = [{ type: "oauth2", scopes: ["openid", "profile", "email"] }];

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  securitySchemes: { type: string; scopes?: string[] }[];
  _meta: { securitySchemes: { type: string; scopes?: string[] }[] };
};

function tool(definition: Omit<Tool, "_meta">): Tool {
  return { ...definition, _meta: { securitySchemes: definition.securitySchemes } };
}

const LOGIN_NOTE = "LIFE HUB のアカウントにログインして使う(初めての時は、ログインの画面が出る)。";

/** 送信コード版。入力は public/chatgpt/openapi.json と同じ(テストで突き合わせる)。 */
export const SEND_TRIP_PLAN_TOOL = tool({
  name: SEND_TRIP_PLAN,
  title: "旅程を LIFE HUB の受信箱へ送る",
  description:
    "ユーザーが旅程を確かめ、LIFE HUB に送るよう頼んだ時だけ呼ぶ。作った旅程を LIFE HUB の受信箱に届ける(日程にはそのまま入らず、ユーザーが LIFE HUB で確かめてから入れる)。送信コードは、ユーザーが会話で伝えたものを使う。金額は送れない。",
  inputSchema: {
    type: "object",
    required: ["code", "items"],
    properties: {
      code: {
        type: "string",
        description: "ユーザーが伝えた LIFE HUB の送信コード。例: LH-ABCD-EFGH-JKLM-NPQR-STUV。ユーザーから聞いた通りに入れる。",
      },
      tripName: { type: "string", description: "旅行の名前。例: 四国旅行" },
      startDate: { type: "string", description: "旅行の最初の日。YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      endDate: { type: "string", description: "旅行の最後の日。YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      items: {
        type: "array",
        description: `日程。1件が1つの予定。1回に${MAX_ITEMS}件まで。`,
        minItems: 1,
        maxItems: MAX_ITEMS,
        items: ITEM_SCHEMA,
      },
    },
  },
  outputSchema: {
    type: "object",
    required: ["ok", "message"],
    properties: {
      ok: { type: "boolean", description: "受信箱に届いたか" },
      received: { type: "integer", description: "届いた件数" },
      skipped: { type: "integer", description: "日付か題名が読めずに除いた件数" },
      message: { type: "string", description: "ユーザーに伝える案内" },
    },
  },
  // 受信箱に置くだけで、日程は変えない。受信箱が20件を超えると古い順に消える以外に、取り消せない変更は無い。
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  securitySchemes: NO_AUTH,
});

export const LIST_TRIPS_TOOL = tool({
  name: LIST_TRIPS,
  title: "LIFE HUB の旅行の一覧",
  description: `ユーザーの LIFE HUB にある旅行(新しい順、50件まで)を返す。旅行に日程を足す前に、どの旅行か(ID)を確かめるために使う。${LOGIN_NOTE}`,
  inputSchema: { type: "object", properties: {} },
  outputSchema: RESULT_SCHEMA,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: OAUTH,
});

export const CREATE_TRIP_TOOL = tool({
  name: CREATE_TRIP,
  title: "LIFE HUB に旅行を作る",
  description: `ユーザーの LIFE HUB に、新しい旅行を1つ作る(計画中として)。同じ名前・同じ期間の旅行をもう一度作ろうとしても、二重にはならず、あるものを返す。作ったあと、add_schedule_items で日程を足す。${LOGIN_NOTE}`,
  inputSchema: {
    type: "object",
    required: ["name", "startDate", "endDate"],
    properties: {
      name: { type: "string", description: "旅行の名前。例: 四国旅行" },
      destination: { type: "string", description: "行き先。分からなければ省く(名前が入る)。" },
      startDate: { type: "string", description: "旅行の最初の日。YYYY-MM-DD", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      endDate: { type: "string", description: "旅行の最後の日。YYYY-MM-DD(60日まで)", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      memo: { type: "string", description: "旅行のメモ。なければ省く。" },
    },
  },
  outputSchema: {
    type: "object",
    required: ["ok", "message"],
    properties: { ...RESULT_SCHEMA.properties, tripId: { type: "string", description: "作った(または既にあった)旅行のID" } },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: OAUTH,
});

export const ADD_SCHEDULE_ITEMS_TOOL = tool({
  name: ADD_SCHEDULE_ITEMS,
  title: "旅行に日程を足す",
  description: `ユーザーが確かめた旅程を、LIFE HUB の旅行の日程に**足す**(すぐに日程表に出る)。消したり、あるものを書き換えたりはしない。同じ予定をもう一度送っても二重にならない。旅行の期間の外の日付は入らない。金額は送れない。旅行のIDは list_trips か create_trip で得る。${LOGIN_NOTE}`,
  inputSchema: {
    type: "object",
    required: ["tripId", "items"],
    properties: {
      tripId: { type: "string", description: "旅行のID(list_trips か create_trip が返したもの)" },
      items: {
        type: "array",
        description: `日程。1件が1つの予定。1回に${MAX_ITEMS}件まで。`,
        minItems: 1,
        maxItems: MAX_ITEMS,
        items: ITEM_SCHEMA,
      },
    },
  },
  outputSchema: {
    type: "object",
    required: ["ok", "message"],
    properties: {
      ...RESULT_SCHEMA.properties,
      added: { type: "integer", description: "新しく入った件数" },
      alreadyThere: { type: "integer", description: "すでにあって、そのままにした件数" },
      skipped: { type: "integer", description: "日付か題名が読めずに除いた件数" },
      outsidePeriod: { type: "integer", description: "旅行の期間の外で、入れなかった件数" },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: OAUTH,
});

export const GET_TRIP_SCHEDULE_TOOL = tool({
  name: GET_TRIP_SCHEDULE,
  title: "旅行の日程を読む",
  description: `LIFE HUB の旅行1つの日程(日付・時刻順、500件まで)を返す。すでにある予定を見て、足りない所だけを足すために使う。${LOGIN_NOTE}`,
  inputSchema: {
    type: "object",
    required: ["tripId"],
    properties: { tripId: { type: "string", description: "旅行のID(list_trips か create_trip が返したもの)" } },
  },
  outputSchema: RESULT_SCHEMA,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: OAUTH,
});

export const TOOLS: Tool[] = [SEND_TRIP_PLAN_TOOL, LIST_TRIPS_TOOL, CREATE_TRIP_TOOL, ADD_SCHEDULE_ITEMS_TOOL, GET_TRIP_SCHEDULE_TOOL];

const INSTRUCTIONS =
  "旅程を作り、ユーザーが LIFE HUB への登録を頼んだ時にだけツールを呼ぶ。LIFE HUB に直接作る時は list_trips → (create_trip) → add_schedule_items の順。送信コードを使う時は send_trip_plan。";

type JsonRpcId = string | number | null;
type RpcResponse = Record<string, unknown>;
type ToolResult = Record<string, unknown>;

export interface McpContext {
  /** Authorization ヘッダーの Bearer トークン。無ければ未ログイン。 */
  accessToken?: string;
  /** 公開されている LIFE HUB の URL(末尾の / なし)。 */
  baseUrl: string;
}

function rpcResult(id: JsonRpcId, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolResult(ok: boolean, message: string, details: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text: message }], structuredContent: { ok, message, ...details }, isError: !ok, ...extra };
}

// ===================================================================== ログインの確認

export type VerifyFailure = "missing" | "invalid" | "expired" | "config";
export type VerifyResult = { ok: true; userId: string; clientId: string } | { ok: false; reason: VerifyFailure };

interface Jwk extends Record<string, unknown> {
  kid?: string;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { at: number; keys: Jwk[] } | null = null;

/** テスト用。鍵の控えを捨てる。 */
export function resetJwksCache(): void {
  jwksCache = null;
}

async function loadJwks(supabaseUrl: string, force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const response = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  if (!response.ok) throw new Error(`jwks ${response.status}`);
  const data = (await response.json()) as { keys?: Jwk[] };
  jwksCache = { at: Date.now(), keys: Array.isArray(data.keys) ? data.keys : [] };
  return jwksCache.keys;
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickKey(keys: Jwk[], kid: unknown): Jwk | undefined {
  return keys.find((candidate) => candidate.kid === kid) ?? (keys.length === 1 && !kid ? keys[0] : undefined);
}

/**
 * ChatGPT が持ってきたアクセストークン(Supabase が出した JWT)を確かめる。
 * 署名(Supabase が公開している鍵 = JWKS)・発行元・期限・ログイン済みのユーザーであること・
 * OAuth で発行されたもの(client_id がある)であることを見る。
 * OAuth を通らない普通のログインのトークンは、ここでは受け付けない(ツールの入り口を OAuth に限るため)。
 */
export async function verifyAccessToken(token: string | undefined, env: Record<string, string | undefined> = process.env): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "missing" };
  const supabaseUrl = env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return { ok: false, reason: "config" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (!header || !payload) return { ok: false, reason: "invalid" };
  const alg = header.alg;
  if (alg !== "ES256" && alg !== "RS256") return { ok: false, reason: "invalid" };

  let key: Jwk | undefined;
  try {
    key = pickKey(await loadJwks(supabaseUrl), header.kid);
    // 鍵を入れ替えた直後かもしれないので、見つからなければ1回だけ取り直す。
    if (!key) key = pickKey(await loadJwks(supabaseUrl, true), header.kid);
  } catch {
    return { ok: false, reason: "config" };
  }
  if (!key) return { ok: false, reason: "invalid" };

  let signatureOk = false;
  try {
    const publicKey = createPublicKey({ key: key as never, format: "jwk" });
    signatureOk = verifySignature(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      alg === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, reason: "invalid" };

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp <= now - 30) return { ok: false, reason: "expired" };
  if (typeof payload.nbf === "number" && payload.nbf > now + 30) return { ok: false, reason: "invalid" };
  if (payload.iss !== `${supabaseUrl}/auth/v1`) return { ok: false, reason: "invalid" };
  if (payload.role !== "authenticated") return { ok: false, reason: "invalid" };
  if (typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub)) return { ok: false, reason: "invalid" };
  if (typeof payload.client_id !== "string" || !payload.client_id) return { ok: false, reason: "invalid" };
  return { ok: true, userId: payload.sub, clientId: payload.client_id };
}

/** ログインが必要な時の返事。ChatGPT がこれを見て、LIFE HUB のログイン画面を出す。 */
export function authRequiredResult(baseUrl: string, reason: VerifyFailure): ToolResult {
  if (reason === "config") {
    return toolResult(false, "LIFE HUB 側のログインの設定を確かめられませんでした。しばらくしてからもう一度お試しください。");
  }
  const description = reason === "expired" ? "The access token expired" : reason === "invalid" ? "The access token is invalid" : "No access token was provided";
  const challenge = `Bearer resource_metadata="${resourceMetadataUrl(baseUrl)}", error="invalid_token", error_description="${description}"`;
  return toolResult(false, "LIFE HUB にログインしてから、もう一度お試しください。", {}, { _meta: { "mcp/www_authenticate": [challenge] } });
}

// ===================================================================== Supabase(その人の権限で)

interface RestReply {
  status: number;
  data: unknown;
}

async function rest(
  path: string,
  token: string,
  options: { method?: string; body?: unknown; prefer?: string } = {},
  env: Record<string, string | undefined> = process.env,
): Promise<RestReply> {
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { status: 503, data: null };
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(options.prefer ? { prefer: options.prefer } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  } catch {
    return { status: 502, data: null };
  }
}

const GENERIC_FAILURE = "LIFE HUB に届けられませんでした。しばらくしてからもう一度お試しください。";

/** Supabase の返事が失敗なら、ツールの失敗に直す。成功なら null。 */
function restFailure(reply: RestReply, baseUrl: string): ToolResult | null {
  if (reply.status >= 200 && reply.status < 300) return null;
  if (reply.status === 401 || reply.status === 403) return authRequiredResult(baseUrl, "invalid");
  if (reply.status === 404) return toolResult(false, "LIFE HUB 側の準備がまだ終わっていません。しばらくしてからもう一度お試しください。");
  return toolResult(false, GENERIC_FAILURE);
}

/** 旅行・予定のIDを、中身から決まる値にする(UUID v5 と同じ作り)。同じ内容は、何度作っても同じID。 */
const ID_NAMESPACE = "6f1b6f0e3f5a4a5e9b1d4c1f7e9a0d11";
export function stableId(name: string): string {
  const hash = createHash("sha1").update(Buffer.from(ID_NAMESPACE, "hex")).update(name, "utf8").digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

const DEVICE_ID = "chatgpt";
const MAX_TRIP_DAYS = 60;

interface TripRow {
  id: string;
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface ScheduleRow {
  date: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  location: string | null;
  memo: string | null;
  type: string;
}

interface Login {
  userId: string;
  token: string;
}

function describeTrip(trip: TripRow): string {
  return `${trip.name}(${trip.start_date}〜${trip.end_date}、ID: ${trip.id})`;
}

async function listTrips(user: Login, ctx: McpContext): Promise<ToolResult> {
  const reply = await rest("trips?deleted_at=is.null&select=id,name,destination,start_date,end_date,status&order=start_date.desc&limit=50", user.token);
  const failure = restFailure(reply, ctx.baseUrl);
  if (failure) return failure;
  const trips = (Array.isArray(reply.data) ? reply.data : []) as TripRow[];
  if (trips.length === 0) return toolResult(true, "LIFE HUB に旅行はまだありません。create_trip で作れます。", { trips: [] });
  const lines = trips.map((trip) => `- ${describeTrip(trip)}`);
  return toolResult(true, `LIFE HUB の旅行(${trips.length}件):\n${lines.join("\n")}`, {
    trips: trips.map((trip) => ({ id: trip.id, name: trip.name, destination: trip.destination, startDate: trip.start_date, endDate: trip.end_date, status: trip.status })),
  });
}

async function createTrip(args: unknown, user: Login, ctx: McpContext): Promise<ToolResult> {
  const value = isObject(args) ? args : {};
  const name = shortText(value.name, 100);
  const startDate = normalizeDate(value.startDate);
  const endDate = normalizeDate(value.endDate);
  if (!name) return toolResult(false, "旅行の名前(name)を入れてください。");
  if (!startDate || !endDate) return toolResult(false, "旅行の最初の日(startDate)と最後の日(endDate)を、YYYY-MM-DD で入れてください。");
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
  if (days < 1) return toolResult(false, "最後の日(endDate)が、最初の日(startDate)より前になっています。");
  if (days > MAX_TRIP_DAYS) return toolResult(false, `旅行の期間は${MAX_TRIP_DAYS}日までです。分けて作ってください。`);

  const id = stableId(`trip|${user.userId}|${name}|${startDate}|${endDate}`);
  const now = new Date().toISOString();
  const row = {
    id,
    user_id: user.userId,
    device_id: DEVICE_ID,
    name,
    destination: shortText(value.destination, 100) ?? name,
    start_date: startDate,
    end_date: endDate,
    memo: shortText(value.memo, 500) ?? null,
    status: "planning",
    created_at: now,
    updated_at: now,
  };
  const reply = await rest("trips?on_conflict=id", user.token, { method: "POST", body: row, prefer: "resolution=ignore-duplicates,return=representation" });
  const failure = restFailure(reply, ctx.baseUrl);
  if (failure) return failure;

  if (Array.isArray(reply.data) && reply.data.length > 0) {
    return toolResult(true, `旅行「${name}」(${startDate}〜${endDate})を作りました。ID: ${id}。続けて add_schedule_items で日程を足せます。`, { tripId: id, created: true });
  }
  // 同じ名前・期間の旅行がすでにある(消されたものかもしれない)。
  const existing = await rest(`trips?id=eq.${id}&select=id,name,start_date,end_date,deleted_at`, user.token);
  const found = Array.isArray(existing.data) ? (existing.data[0] as (TripRow & { deleted_at?: string | null }) | undefined) : undefined;
  if (found && !found.deleted_at) {
    return toolResult(true, `同じ名前・期間の旅行「${name}」がすでにあります。ID: ${id}。そのまま add_schedule_items で日程を足せます。`, { tripId: id, created: false });
  }
  return toolResult(false, `「${name}」(${startDate}〜${endDate})は、以前消された旅行と同じ名前・期間です。別の名前にして作り直してください。`);
}

async function findTrip(tripId: unknown, user: Login, ctx: McpContext): Promise<{ trip: TripRow } | { failure: ToolResult }> {
  if (typeof tripId !== "string" || !UUID_PATTERN.test(tripId)) {
    return { failure: toolResult(false, "旅行のID(tripId)が正しくありません。list_trips か create_trip が返したIDを、そのまま入れてください。") };
  }
  const reply = await rest(`trips?id=eq.${tripId}&deleted_at=is.null&select=id,name,destination,start_date,end_date,status`, user.token);
  const failure = restFailure(reply, ctx.baseUrl);
  if (failure) return { failure };
  const trip = Array.isArray(reply.data) ? (reply.data[0] as TripRow | undefined) : undefined;
  if (!trip) return { failure: toolResult(false, "その旅行が見つかりません。list_trips で、IDをもう一度確かめてください。") };
  return { trip };
}

async function addScheduleItems(args: unknown, user: Login, ctx: McpContext): Promise<ToolResult> {
  const value = isObject(args) ? args : {};
  if (!Array.isArray(value.items) || value.items.length === 0) {
    return toolResult(false, "日程の items が空です。日付と題名のある予定を1件以上入れてください。");
  }
  if (value.items.length > MAX_ITEMS) {
    return toolResult(false, `一度に入れられるのは${MAX_ITEMS}件までです。前半と後半に分けて、2回に分けて入れてください。`);
  }
  const found = await findTrip(value.tripId, user, ctx);
  if ("failure" in found) return found.failure;
  const { trip } = found;

  const { items, skipped } = parseItems(value.items);
  if (items.length === 0) {
    return toolResult(false, "日付(YYYY-MM-DD)と題名が読み取れた予定がありませんでした。date と title を入れてください。");
  }
  const inside = items.filter((item) => item.date >= trip.start_date && item.date <= trip.end_date);
  const outsidePeriod = items.length - inside.length;
  if (inside.length === 0) {
    return toolResult(
      false,
      `どの予定も、この旅行の期間(${trip.start_date}〜${trip.end_date})の外の日付です。日付を確かめてください。期間を変えたい時は、LIFE HUB で旅行の期間を直してからにしてください。`,
    );
  }

  const now = new Date().toISOString();
  const rows = inside.map((item) => ({
    id: stableId(`schedule|${trip.id}|${item.date}|${item.startTime ?? ""}|${item.title}`),
    user_id: user.userId,
    device_id: DEVICE_ID,
    trip_id: trip.id,
    date: item.date,
    start_time: item.startTime ?? null,
    end_time: item.endTime ?? null,
    title: item.title,
    location: item.location ?? null,
    memo: item.memo ?? null,
    type: item.type,
    created_at: now,
    updated_at: now,
  }));
  // 同じ予定(同じ旅行・日付・時刻・題名)がすでにあれば、そのまま(上書きしない・消えていたら戻さない)。
  const reply = await rest("trip_schedule?on_conflict=id", user.token, { method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=representation" });
  const failure = restFailure(reply, ctx.baseUrl);
  if (failure) return failure;
  const added = Array.isArray(reply.data) ? reply.data.length : 0;
  const alreadyThere = rows.length - added;

  const notes = [
    alreadyThere > 0 ? `すでにあった${alreadyThere}件はそのままにしました` : "",
    outsidePeriod > 0 ? `旅行の期間の外だった${outsidePeriod}件は入れませんでした` : "",
    skipped > 0 ? `日付か題名が読めなかった${skipped}件は除きました` : "",
  ].filter(Boolean);
  const message = `旅行「${trip.name}」の日程に${added}件を足しました${notes.length ? `(${notes.join("、")})` : ""}。LIFE HUB の旅行の「日程」に出ています。`;
  return toolResult(true, message, { tripId: trip.id, added, alreadyThere, skipped, outsidePeriod });
}

async function getTripSchedule(args: unknown, user: Login, ctx: McpContext): Promise<ToolResult> {
  const value = isObject(args) ? args : {};
  const found = await findTrip(value.tripId, user, ctx);
  if ("failure" in found) return found.failure;
  const { trip } = found;
  const reply = await rest(
    `trip_schedule?trip_id=eq.${trip.id}&deleted_at=is.null&select=date,start_time,end_time,title,location,memo,type&order=date.asc,start_time.asc.nullsfirst&limit=500`,
    user.token,
  );
  const failure = restFailure(reply, ctx.baseUrl);
  if (failure) return failure;
  const rows = (Array.isArray(reply.data) ? reply.data : []) as ScheduleRow[];
  const lines = rows.map((row) => `- ${row.date} ${row.start_time ?? "--:--"}${row.end_time ? `〜${row.end_time}` : ""} ${row.title}${row.location ? `(${row.location})` : ""}`);
  const message = rows.length === 0 ? `旅行「${trip.name}」の日程は、まだ空です。` : `旅行「${trip.name}」の日程(${rows.length}件):\n${lines.join("\n")}`;
  return toolResult(true, message, {
    trip: { id: trip.id, name: trip.name, startDate: trip.start_date, endDate: trip.end_date },
    items: rows.map((row) => ({ date: row.date, startTime: row.start_time, endTime: row.end_time, title: row.title, location: row.location, memo: row.memo, type: row.type })),
  });
}

/** ツール1つを呼ぶ。ログインが要るツールは、トークンを確かめてから、その人の権限で動く。知らないツールは null。 */
export async function callTool(name: string, args: unknown, ctx: McpContext): Promise<ToolResult | null> {
  if (name === SEND_TRIP_PLAN) {
    const reply = await deliverTripPlan(args);
    const { ok, received, skipped, message } = reply.body;
    return toolResult(ok, message, {
      ...(received !== undefined ? { received } : {}),
      ...(skipped !== undefined ? { skipped } : {}),
    });
  }
  if (![LIST_TRIPS, CREATE_TRIP, ADD_SCHEDULE_ITEMS, GET_TRIP_SCHEDULE].includes(name)) return null;

  const verified = await verifyAccessToken(ctx.accessToken);
  if (!verified.ok) return authRequiredResult(ctx.baseUrl, verified.reason);
  const user: Login = { userId: verified.userId, token: ctx.accessToken as string };
  switch (name) {
    case LIST_TRIPS:
      return listTrips(user, ctx);
    case CREATE_TRIP:
      return createTrip(args, user, ctx);
    case ADD_SCHEDULE_ITEMS:
      return addScheduleItems(args, user, ctx);
    default:
      return getTripSchedule(args, user, ctx);
  }
}

// ===================================================================== JSON-RPC

/**
 * JSON-RPC のメッセージ1件を処理する。返事が要らないもの(通知・相手からの返事)は null。
 * ステートレスなので、メッセージの中身とヘッダー(ctx)だけで答えが決まる。
 */
export async function handleMcpMessage(message: unknown, ctx: McpContext = { baseUrl: publicBaseUrl() }): Promise<RpcResponse | null> {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return rpcError(null, -32600, "Invalid Request");
  }
  const hasId = "id" in message;
  const id = (hasId ? message.id : null) as JsonRpcId;
  const method = message.method;

  // 相手からの返事(result / error だけで method が無い)は受け取るだけ。
  if (typeof method !== "string") {
    return hasId && ("result" in message || "error" in message) ? null : rpcError(id, -32600, "Invalid Request");
  }

  const params = isObject(message.params) ? message.params : {};

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return hasId ? rpcResult(id, {}) : null;
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const result = await callTool(String(params.name), params.arguments, ctx);
      if (result === null) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      return rpcResult(id, result);
    }
    default:
      // 通知(id が無い)は、知らないものでも黙って受ける。
      return hasId ? rpcError(id, -32601, `Method not found: ${method}`) : null;
  }
}

/** POST の本文(1件、または配列)を処理する。返事が1つも無ければ null(→ 202)。 */
export async function handleMcpBody(body: unknown, ctx: McpContext = { baseUrl: publicBaseUrl() }): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, -32600, "Invalid Request");
    const replies = (await Promise.all(body.map((message) => handleMcpMessage(message, ctx)))).filter(
      (reply): reply is RpcResponse => reply !== null,
    );
    return replies.length > 0 ? replies : null;
  }
  return handleMcpMessage(body, ctx);
}

/** Authorization ヘッダーから Bearer トークンを取り出す。 */
export function bearerToken(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

function jsonResponse(statusCode: number, body: unknown, headers: Record<string, string> = {}) {
  return { statusCode, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    // 通知を流すための GET の待ち受けは持たない(ステートレスのため)。仕様が認める 405。
    return jsonResponse(405, rpcError(null, -32000, "Method not allowed"), { allow: "POST" });
  }

  let body: unknown;
  try {
    const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    body = JSON.parse(raw ?? "null");
  } catch {
    return jsonResponse(400, rpcError(null, -32700, "Parse error"));
  }

  const reply = await handleMcpBody(body, { accessToken: bearerToken(event.headers.authorization), baseUrl: publicBaseUrl() });
  if (reply === null) return { statusCode: 202, body: "" };
  return jsonResponse(200, reply);
};
