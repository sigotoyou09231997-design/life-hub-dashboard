/**
 * 海外サッカーで選んだチームを、アカウントに紐づけて別の端末にも同じにする(src/lib/hiddenFeaturesSync.ts と同じ決まり)。
 *
 * - **サーバーに値があれば、それが正**。PCで選べば、スマホは次に開いた時に追いつく(取り込んだ試合は予定として
 *   同期されるが、日程を取り直すのは「チームを知っている端末」だけなので、選択も揃えないとスマホは更新されない)。
 * - サーバーにまだ無く、この端末で選んでいれば、それを送って元にする。
 * - 送れなかった変更は「未送信」の印を残し、次の機会に送る。印がある間は、サーバーの古い値で上書きしない。
 */
import { scopedKey } from "./accounts";
import { hasStoredSoccerTeams, loadSoccerTeams, saveSoccerTeams, type SoccerTeam } from "./soccerFixtures";
import { readUserMetadata, writeUserMetadata } from "./userMetadata";

export const SOCCER_TEAMS_REMOTE_KEY = "lifeHubSoccerTeams";
const UNSENT_KEY = "lifeHubSoccerTeamsUnsent:v1";

export interface SoccerTeamsRemote {
  /** 読めなかったら undefined。サーバーにまだ無ければ null。 */
  read(): Promise<unknown | null | undefined>;
  /** 送れたら true。 */
  write(teams: SoccerTeam[]): Promise<boolean>;
}

type SyncStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function setUnsent(storage: SyncStorage, unsent: boolean): void {
  try {
    if (unsent) storage.setItem(scopedKey(UNSENT_KEY), "1");
    else storage.removeItem(scopedKey(UNSENT_KEY));
  } catch {
    // 印を残せないだけ。選択そのものは画面の上では動く。
  }
}

function isUnsent(storage: SyncStorage): boolean {
  try {
    return storage.getItem(scopedKey(UNSENT_KEY)) !== null;
  } catch {
    return false;
  }
}

function normalize(value: unknown): SoccerTeam[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (t): t is SoccerTeam => !!t && typeof t.id === "string" && typeof t.name === "string" && typeof t.league === "string",
  );
}

const CHECKED_AT_KEY = "lifeHubSoccerTeamsCheckedAt:v1";
/** 起動のたびにサーバーへ聞かない間隔。画面を行き来するたびに通信が走らないように。 */
export const SOCCER_TEAMS_CHECK_COOLDOWN_MS = 10 * 60 * 1000;

export function shouldCheckSoccerTeams(now: number, storage: Pick<Storage, "getItem"> = window.localStorage): boolean {
  try {
    return now - (Number(storage.getItem(scopedKey(CHECKED_AT_KEY))) || 0) >= SOCCER_TEAMS_CHECK_COOLDOWN_MS;
  } catch {
    return true;
  }
}

export function markSoccerTeamsChecked(now: number, storage: Pick<Storage, "setItem"> = window.localStorage): void {
  try {
    storage.setItem(scopedKey(CHECKED_AT_KEY), String(now));
  } catch {
    // 印を残せないだけ。次にもう一度聞くだけで済む。
  }
}

/** 選択を送る。送れなければ「未送信」の印を残して、次の機会に送り直す。 */
export async function pushSoccerTeams(
  teams: SoccerTeam[],
  remote: SoccerTeamsRemote = supabaseSoccerTeamsRemote,
  storage: SyncStorage = window.localStorage,
): Promise<void> {
  setUnsent(storage, true);
  let sent = false;
  try {
    sent = await remote.write(teams);
  } catch {
    sent = false;
  }
  if (sent) setUnsent(storage, false);
}

/** サーバーの選択と突き合わせて、いまのこの端末の選択を返す。 */
export async function syncSoccerTeams(
  remote: SoccerTeamsRemote = supabaseSoccerTeamsRemote,
  storage: SyncStorage = window.localStorage,
): Promise<SoccerTeam[]> {
  const local = loadSoccerTeams(storage);
  if (isUnsent(storage)) {
    await pushSoccerTeams(local, remote, storage);
    return local;
  }
  let remoteValue: unknown | null | undefined;
  try {
    remoteValue = await remote.read();
  } catch {
    return local;
  }
  if (remoteValue === undefined) return local;
  const next = normalize(remoteValue);
  if (!next) {
    if (hasStoredSoccerTeams(storage)) await pushSoccerTeams(local, remote, storage);
    return local;
  }
  saveSoccerTeams(next, storage);
  return next;
}

export const supabaseSoccerTeamsRemote: SoccerTeamsRemote = {
  read: () => readUserMetadata(SOCCER_TEAMS_REMOTE_KEY),
  write: (teams) => writeUserMetadata(SOCCER_TEAMS_REMOTE_KEY, teams),
};
