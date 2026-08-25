import { GoTrueClient } from "@supabase/auth-js";
import { BOOT_SLOT } from "./accounts";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** True once VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set — lets the UI hide
 * the account-sync section entirely on deployments that haven't configured it yet. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const resolvedUrl = supabaseUrl || "https://placeholder.supabase.co";
const resolvedAnonKey = supabaseAnonKey || "placeholder";
const projectRef = new URL(resolvedUrl).hostname.split(".")[0];

/** アカウントごとのセッションの置き場所。slot が null のアカウントだけが、Supabaseの
 * 既定と同じキーを使う — この機能より前からログインしている端末で、そのままログイン
 * 状態を引き継ぐため。2つ目以降はキーを分けるので、切り替えても互いのログインが
 * 消えない(保存先はどちらもlocalStorageで、Supabaseの既定の置き方と同じ)。 */
export function authStorageKey(slot: string | null): string {
  return slot === null ? `sb-${projectRef}-auth-token` : `sb-${projectRef}-auth-token-${slot}`;
}

/** Auth-only client kept in the initial bundle. Its settings intentionally match
 * createClient()'s browser defaults so existing persisted sessions and OAuth
 * callbacks remain compatible after splitting the data client. */
export const auth = new GoTrueClient({
  url: `${resolvedUrl}/auth/v1`,
  headers: {
    apikey: resolvedAnonKey,
    Authorization: `Bearer ${resolvedAnonKey}`,
  },
  storageKey: authStorageKey(BOOT_SLOT),
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: "implicit",
});

/** 保存済みセッションを別の置き場所へ移す。アカウント追加のログインが終わったあと、
 * 一時領域に入った新しいセッションをそのアカウント専用のキーへ移すために使う。 */
export function moveStoredSession(fromSlot: string | null, toSlot: string | null): void {
  try {
    const value = window.localStorage.getItem(authStorageKey(fromSlot));
    if (value === null) return;
    window.localStorage.setItem(authStorageKey(toSlot), value);
    window.localStorage.removeItem(authStorageKey(fromSlot));
  } catch {
    // 書けない環境では移せないが、この直後の再読み込みでログイン画面に戻るだけ。
  }
}

export function clearStoredSession(slot: string | null): void {
  try {
    window.localStorage.removeItem(authStorageKey(slot));
  } catch {
    // 同上。
  }
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  return { url: resolvedUrl, anonKey: resolvedAnonKey };
}

export function getRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}
