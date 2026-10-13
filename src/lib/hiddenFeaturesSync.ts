/**
 * 隠す機能の設定を、アカウントに紐づけて、別の端末にも同じにする(src/components/layout/quickActionsSync.ts と同じ決まり)。
 *
 * - **サーバーに値があれば、それが正**。別の端末で変えたら、次に開いた時(アプリに戻った時)に追いつく。
 * - サーバーにまだ無く、この端末で設定済みなら、それを送って元にする。
 * - 送れなかった変更(通信が切れていた)は「未送信」の印を残し、次の機会に送る。印がある間は、サーバーの古い値で上書きしない。
 * - 「何も隠さない」も、設定の1つ(空の配列)として送る。別の端末で全部戻したら、こちらも戻る。
 */
import { scopedKey } from "./accounts";
import {
  hasStoredHiddenFeatures,
  loadHiddenFeatures,
  normalizeHiddenFeatures,
  sameHiddenFeatures,
  saveHiddenFeatures,
  type HideableFeature,
} from "./hiddenFeatures";
import { readUserMetadata, writeUserMetadata } from "./userMetadata";

/** user_metadata の中の名前。 */
export const HIDDEN_FEATURES_REMOTE_KEY = "lifeHubHiddenFeatures";
const UNSENT_KEY = "lifeHubHiddenFeaturesUnsent:v1";

export interface HiddenFeaturesRemote {
  /** 読めなかったら undefined。サーバーにまだ無ければ null。 */
  read(): Promise<unknown | null | undefined>;
  /** 送れたら true。 */
  write(hidden: HideableFeature[]): Promise<boolean>;
}

type SyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const unsentKey = () => scopedKey(UNSENT_KEY);

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
    // 書けない環境では印を残せないだけ。設定そのものは画面の上では動く。
  }
}

/** 設定を送る。送れなければ「未送信」の印を残して、次の機会に送り直す。 */
export async function pushHiddenFeatures(
  hidden: HideableFeature[],
  remote: HiddenFeaturesRemote = supabaseHiddenFeaturesRemote,
  storage: SyncStorage = window.localStorage,
): Promise<void> {
  setUnsent(storage, true);
  let sent = false;
  try {
    sent = await remote.write(hidden);
  } catch {
    sent = false;
  }
  if (sent) setUnsent(storage, false);
}

/**
 * サーバーの設定と突き合わせる。この端末の設定が変わったら、新しい設定を返す(画面を直す用)。変わらなければ null。
 */
export async function syncHiddenFeatures(
  remote: HiddenFeaturesRemote = supabaseHiddenFeaturesRemote,
  storage: SyncStorage = window.localStorage,
): Promise<HideableFeature[] | null> {
  const local = loadHiddenFeatures(storage);
  if (isUnsent(storage)) {
    await pushHiddenFeatures(local, remote, storage);
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
    if (hasStoredHiddenFeatures(storage)) await pushHiddenFeatures(local, remote, storage);
    return null;
  }
  const next = normalizeHiddenFeatures(remoteValue);
  if (hasStoredHiddenFeatures(storage) && sameHiddenFeatures(next, local)) return null;
  saveHiddenFeatures(next, storage);
  return sameHiddenFeatures(next, local) ? null : next;
}

export const supabaseHiddenFeaturesRemote: HiddenFeaturesRemote = {
  read: () => readUserMetadata(HIDDEN_FEATURES_REMOTE_KEY),
  write: (hidden) => writeUserMetadata(HIDDEN_FEATURES_REMOTE_KEY, hidden),
};
