/**
 * Supabase のログイン情報(user_metadata)に、アカウントごとの小さな設定を読み書きする。
 * 新しい表も SQL も要らず、そのアカウントでログインした端末なら、どこからでも同じ値が読める。
 *
 * `auth.updateUser` は使わず、ユーザー情報の窓口を直接呼ぶ — updateUser は「ユーザーが更新された」の知らせを出し、
 * App.tsx がそのたびに同期を組み直してしまうため(src/components/layout/quickActionsSync.ts と同じ理由)。
 * 読めない(オフライン・未ログイン・アカウント追加中)ときは undefined、サーバーにまだ無ければ null。
 */
import { IS_ADDING_ACCOUNT } from "./accounts";
import { auth, getSupabaseConfig, isSupabaseConfigured } from "./supabase";

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function readUserMetadata(key: string): Promise<unknown | null | undefined> {
  if (!isSupabaseConfigured || IS_ADDING_ACCOUNT) return undefined;
  try {
    const token = await accessToken();
    if (!token) return undefined;
    const { url, anonKey } = getSupabaseConfig();
    const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { user_metadata?: Record<string, unknown> } | null;
    return body?.user_metadata?.[key] ?? null;
  } catch {
    return undefined;
  }
}

/** 送れたら true。 */
export async function writeUserMetadata(key: string, value: unknown): Promise<boolean> {
  if (!isSupabaseConfigured || IS_ADDING_ACCOUNT) return false;
  try {
    const token = await accessToken();
    if (!token) return false;
    const { url, anonKey } = getSupabaseConfig();
    const response = await fetch(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { [key]: value } }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
