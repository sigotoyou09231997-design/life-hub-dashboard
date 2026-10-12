import { IS_ADDING_ACCOUNT, scopedKey } from "../../lib/accounts";
import { auth, getSupabaseConfig, isSupabaseConfigured } from "../../lib/supabase";
import {
  hasStoredQuickActionKeys,
  loadQuickActionKeys,
  normalizeQuickActionKeys,
  saveQuickActionKeys,
  type QuickActionKey,
} from "./quickActions";

/**
 * 下の追従ナビの並びを、アカウントに紐づけて、別の端末にも同じにする(2026-10-13、本人「追従ボタンが
 * アカウントごとに紐づいてない。端末ごとになってる」)。
 *
 * 置き場所は Supabase のログイン情報(user_metadata)。新しい表も SQL も要らず、そのアカウントで
 * ログインした端末なら、どこからでも同じ値が読める。端末の中(localStorage)の写しは今までどおり
 * 残すので、通信できなくても並びはすぐ出る。
 *
 * 決まり:
 * - **サーバーに値があれば、それが正**。別の端末で並べ替えたら、次に開いた時(アプリに戻った時)に追いつく。
 * - サーバーにまだ無く、この端末で並べ替え済みなら、その並びを送って元にする(今までの人が並びを失わない)。
 * - 送れなかった並べ替え(通信が切れていた)は「未送信」の印を残し、次の機会に送る。印がある間は、
 *   サーバーの古い値で、いま並べたものを上書きしない。
 * - 読み書きは `auth.updateUser` を使わず、Supabase のユーザー情報の窓口を直接呼ぶ。updateUser は
 *   「ユーザーが更新された」の知らせを出し、App.tsx がそのたびに同期を組み直してしまうため。
 */

/** user_metadata の中の名前。 */
export const QUICK_ACTION_REMOTE_KEY = "lifeHubQuickActions";
const UNSENT_KEY = "lifeHubQuickActionsUnsent:v1";

export interface QuickActionRemote {
  /** 読めなかった(オフライン・未ログインなど)なら undefined。サーバーにまだ無ければ null。 */
  read(): Promise<unknown | null | undefined>;
  /** 送れたら true。 */
  write(keys: QuickActionKey[]): Promise<boolean>;
}

type SyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function unsentKey(): string {
  return scopedKey(UNSENT_KEY);
}

function isUnsent(storage: SyncStorage): boolean {
  try {
    return storage.getItem(unsentKey()) !== null;
  } catch {
    return false;
  }
}

function setUnsent(storage: SyncStorage, unsent: boolean): void {
  try {
    if (unsent) storage.setItem(unsentKey(), "1");
    else storage.removeItem(unsentKey());
  } catch {
    // 書けない環境では印を残せないだけ。並びそのものは画面の上では動く。
  }
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** 並べ替えを送る。送れなければ「未送信」の印を残して、次の機会に送り直す。 */
export async function pushQuickActions(
  keys: QuickActionKey[],
  remote: QuickActionRemote,
  storage: SyncStorage = window.localStorage,
): Promise<void> {
  setUnsent(storage, true);
  let sent = false;
  try {
    sent = await remote.write(keys);
  } catch {
    sent = false;
  }
  if (sent) setUnsent(storage, false);
}

/**
 * サーバーの並びと突き合わせる。この端末の並びが変わったら、その新しい並びを返す(画面を直す用)。
 * 変わらなければ null。
 */
export async function syncQuickActions(
  remote: QuickActionRemote,
  storage: SyncStorage = window.localStorage,
): Promise<QuickActionKey[] | null> {
  const local = loadQuickActionKeys(storage);
  // 送れていない並べ替えが先。サーバーの古い値で消さない。
  if (isUnsent(storage)) {
    await pushQuickActions(local, remote, storage);
    return null;
  }
  let remoteValue: unknown | null | undefined;
  try {
    remoteValue = await remote.read();
  } catch {
    return null;
  }
  if (remoteValue === undefined) return null;
  if (!Array.isArray(remoteValue)) {
    // サーバーにまだ無い。この端末で並べ替え済みなら、それを元にする。
    if (hasStoredQuickActionKeys(storage)) await pushQuickActions(local, remote, storage);
    return null;
  }
  const next = normalizeQuickActionKeys(remoteValue);
  if (hasStoredQuickActionKeys(storage) && sameKeys(next, local)) return null;
  saveQuickActionKeys(next, storage);
  return sameKeys(next, local) ? null : next;
}

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Supabase のログイン情報(user_metadata)に読み書きする本物の窓口。 */
export const supabaseQuickActionRemote: QuickActionRemote = {
  async read() {
    if (!isSupabaseConfigured || IS_ADDING_ACCOUNT) return undefined;
    try {
      const token = await accessToken();
      if (!token) return undefined;
      const { url, anonKey } = getSupabaseConfig();
      const response = await fetch(`${url}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { user_metadata?: Record<string, unknown> } | null;
      const value = body?.user_metadata?.[QUICK_ACTION_REMOTE_KEY];
      return Array.isArray(value) ? value : null;
    } catch {
      return undefined;
    }
  },
  async write(keys) {
    if (!isSupabaseConfigured || IS_ADDING_ACCOUNT) return false;
    try {
      const token = await accessToken();
      if (!token) return false;
      const { url, anonKey } = getSupabaseConfig();
      const response = await fetch(`${url}/auth/v1/user`, {
        method: "PUT",
        headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ data: { [QUICK_ACTION_REMOTE_KEY]: keys } }),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
