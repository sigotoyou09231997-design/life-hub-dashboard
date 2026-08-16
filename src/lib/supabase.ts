import { GoTrueClient } from "@supabase/auth-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** True once VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set — lets the UI hide
 * the account-sync section entirely on deployments that haven't configured it yet. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const resolvedUrl = supabaseUrl || "https://placeholder.supabase.co";
const resolvedAnonKey = supabaseAnonKey || "placeholder";
const projectRef = new URL(resolvedUrl).hostname.split(".")[0];

/** Auth-only client kept in the initial bundle. Its settings intentionally match
 * createClient()'s browser defaults so existing persisted sessions and OAuth
 * callbacks remain compatible after splitting the data client. */
export const auth = new GoTrueClient({
  url: `${resolvedUrl}/auth/v1`,
  headers: {
    apikey: resolvedAnonKey,
    Authorization: `Bearer ${resolvedAnonKey}`,
  },
  storageKey: `sb-${projectRef}-auth-token`,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: "implicit",
});

export function getSupabaseConfig(): { url: string; anonKey: string } {
  return { url: resolvedUrl, anonKey: resolvedAnonKey };
}

export function getRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}
