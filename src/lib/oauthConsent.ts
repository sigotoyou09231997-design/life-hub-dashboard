/**
 * ChatGPT(などの外のアプリ)が「LIFE HUB のアカウントに接続したい」と求めてきた時の、同意画面の部品。
 *
 * ログインそのものは Supabase Auth の OAuth 2.1 サーバーが行う。流れ:
 *   ChatGPT → Supabase の /oauth/authorize → ここ(/oauth/consent?authorization_id=…)に飛ばされる
 *   → 本人が「許可する」「許可しない」を選ぶ → Supabase が返す URL(ChatGPT 側)へ戻す。
 * 許可の結果は、Supabase が ChatGPT に渡す「アクセストークン」になる。MCP サーバー(api/mcp.ts)が
 * それを確かめて、その人の権限で旅行・日程を読み書きする。
 *
 * 画面(src/pages/OAuthConsentPage.tsx)に出す前に、ここで次を守る:
 * - 戻り先(redirect_uri)が、ChatGPT(OpenAI)のドメインか。クライアントは自分で名前を付けて登録できる
 *   ので、名前だけでは信用できない。違う先なら、許可できない形にする。
 * - 未ログインで来た人が、Google ログインの往復のあとも、この画面に戻れる(authorization_id を預かる)。
 */
import { auth } from "./supabase";

const PENDING_KEY = "lifehub.pendingOAuthConsent";
/** Supabase の認可の依頼は短時間で期限が切れる。預かった印も、同じくらいで捨てる。 */
const PENDING_TTL_MS = 15 * 60 * 1000;

/** 接続を許してよい戻り先のドメイン(ChatGPT)。サブドメインも含める。 */
export const TRUSTED_REDIRECT_HOSTS = ["chatgpt.com", "openai.com"];

/** /oauth/consent。Supabase の「Site URL の末尾の / + パスの先頭の /」で、/ が重なって来ることがある。 */
export function isOAuthConsentPath(pathname: string): boolean {
  return /^\/+oauth\/consent\/?$/.test(pathname);
}

/** URL の ?authorization_id=… を取り出す。形が違えば null。 */
export function readAuthorizationId(search: string): string | null {
  const id = new URLSearchParams(search).get("authorization_id");
  return id && /^[\w-]{8,200}$/.test(id) ? id : null;
}

export function redirectHost(uri: string): string | null {
  try {
    const url = new URL(uri);
    return url.hostname || null;
  } catch {
    return null;
  }
}

/** 戻り先が ChatGPT(OpenAI)か。https だけ。 */
export function isTrustedRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:") return false;
    return TRUSTED_REDIRECT_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** ログインの往復の前に、同意画面の依頼(authorization_id)を預かる。 */
export function rememberPendingConsent(search: string, now: number = Date.now()): void {
  const id = readAuthorizationId(search);
  if (!id) return;
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id, at: now }));
  } catch {
    // 預けられない環境では、ログイン後に ChatGPT からやり直してもらうだけ。
  }
}

/** 預かった依頼があれば、戻る先(/oauth/consent?…)を返して、預かりを捨てる。期限切れ・無ければ null。 */
export function takePendingConsent(now: number = Date.now()): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const { id, at } = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || typeof at !== "number" || now - at > PENDING_TTL_MS) return null;
    if (!readAuthorizationId(`?authorization_id=${encodeURIComponent(id)}`)) return null;
    return `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
}

export interface ConsentDetails {
  authorizationId: string;
  clientName: string;
  redirectUri: string;
  /** 接続するアカウントのメール。 */
  email: string;
  trusted: boolean;
}

export type ConsentLoad =
  | { kind: "consent"; details: ConsentDetails }
  /** すでに許可済み。そのまま戻り先へ送る。 */
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

const EXPIRED_MESSAGE =
  "この接続の依頼は、期限が切れたか、すでに使われています。ChatGPT に戻って、もう一度「接続する」からやり直してください。";

/** 別のサイトへ移る(テストで差し替えるために、ここに置く)。 */
export function goTo(url: string): void {
  window.location.assign(url);
}

/** 認可の依頼の中身を、Supabase に聞く。 */
export async function loadConsent(authorizationId: string): Promise<ConsentLoad> {
  try {
    const { data, error } = await auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) return { kind: "error", message: EXPIRED_MESSAGE };
    if ("redirect_url" in data) {
      // すでに許可済み。ただし戻り先が ChatGPT 以外なら、勝手には送らない。
      return isTrustedRedirect(data.redirect_url)
        ? { kind: "redirect", url: data.redirect_url }
        : { kind: "error", message: "接続の戻り先が、ChatGPT のものではありませんでした。何もせずに止めました。" };
    }
    return {
      kind: "consent",
      details: {
        authorizationId: data.authorization_id,
        clientName: data.client?.name?.trim() || "(名前のないアプリ)",
        redirectUri: data.redirect_uri,
        email: data.user?.email ?? "",
        trusted: isTrustedRedirect(data.redirect_uri),
      },
    };
  } catch (err) {
    console.warn("[oauthConsent] could not read the authorization:", err);
    return { kind: "error", message: "接続の依頼を読み込めませんでした。通信を確かめて、もう一度お試しください。" };
  }
}

/**
 * 許可する/しない。成功したら、移る先の URL と、それが ChatGPT のものかを返す。
 * 許可の結果(認可コード)は、ChatGPT 以外には渡さない — 許可で戻り先が違えば止める。
 * 拒否は何も渡らないが、戻り先が違えば、呼び出し側は移らずにその場で「拒否しました」と出す。
 */
export async function decideConsent(authorizationId: string, approve: boolean): Promise<{ redirectUrl: string; trusted: boolean }> {
  const { data, error } = approve
    ? await auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) throw new Error(error?.message ?? "no redirect url");
  const trusted = isTrustedRedirect(data.redirect_url);
  if (approve && !trusted) throw new Error("untrusted redirect");
  return { redirectUrl: data.redirect_url, trusted };
}
