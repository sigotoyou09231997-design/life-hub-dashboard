import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** True once VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set — lets the UI hide
 * the account-sync section entirely on deployments that haven't configured it yet. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseAnonKey || "placeholder");

export function getRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}
