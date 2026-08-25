import { LifeHubDB } from "../db/schema";
import type { CalendarEvent } from "../types";
import { accountLabel, getActiveAccount, listAccounts } from "./accounts";
import { getDeviceId } from "./deviceId";

/** 予定を入れられる、いま開いていない方のアカウント。 */
export interface OtherAccount {
  userId: string;
  dbName: string;
  label: string;
  email: string | null;
}

/** いま開いているアカウント以外で、この端末に登録済みのもの。1つも無ければ空 —
 * 予定フォームの複製欄は、この結果が空でない時だけ出す。 */
export function listOtherAccounts(): OtherAccount[] {
  const activeUserId = getActiveAccount()?.userId;
  return listAccounts()
    .filter((account) => account.userId !== activeUserId)
    .map((account) => ({
      userId: account.userId,
      dbName: account.dbName,
      label: accountLabel(account),
      email: account.email,
    }));
}

/** 予定フォームの「ほかのアカウントにも入れる」欄1行分の状態。 */
export interface AccountEventDraft {
  checked: boolean;
  title: string;
  /** 本人がこの行のタイトルを個別に書き換えたか。まだなら上のタイトルに追従する。 */
  edited: boolean;
}

export function emptyDrafts(accounts: OtherAccount[], title: string): Record<string, AccountEventDraft> {
  // 既定はオフ。ここをオンにすると、片方のアカウントだけに入れたい普段の予定まで
  // 黙って両方に増えてしまう。
  return Object.fromEntries(accounts.map((a) => [a.userId, { checked: false, title, edited: false }]));
}

/** 上のタイトルを打ち替えた時に、まだ手を付けていない行だけ追従させる。
 * 一度でも個別に書き換えた行は、そのまま残す — 「会社名はこっちには出したくない」で
 * 書き換えた名前が、上を直すたびに戻ってしまわないようにするため。 */
export function followMainTitle(
  drafts: Record<string, AccountEventDraft>,
  mainTitle: string,
): Record<string, AccountEventDraft> {
  return Object.fromEntries(
    Object.entries(drafts).map(([userId, draft]) => [
      userId,
      draft.edited ? draft : { ...draft, title: mainTitle },
    ]),
  );
}

export interface PlannedAccountEvent {
  account: OtherAccount;
  title: string;
}

/** 実際に書き込むぶんだけを取り出す。チェックが入っていて、名前が空でないもの
 * (空なら上のタイトルをそのまま使う)。 */
export function planAccountEvents(
  accounts: OtherAccount[],
  drafts: Record<string, AccountEventDraft>,
  mainTitle: string,
): PlannedAccountEvent[] {
  return accounts
    .filter((account) => drafts[account.userId]?.checked)
    .map((account) => ({ account, title: drafts[account.userId].title.trim() || mainTitle }));
}

/** 別のアカウントのスケジュールに、同じ内容の予定を1件足す。
 *
 * アカウントごとにIndexedDBが分かれている(src/lib/accounts.ts)ので、相手のDBを名前で
 * 開いて直接書く。同期の仕掛け(src/lib/sync.ts の registerSyncedTable)は「いま開いて
 * いるDB」のテーブルにしか付いていないため、userId・deviceId の付与と syncQueue への
 * 積み込みはここで手で行う — これが無いと、相手のアカウントに切り替えた時にその予定が
 * 他の端末へ上がらないまま、この端末の中だけに残る。
 *
 * 相手のDBは書いたらすぐ閉じる。開いたままにしておくと、その後スキーマを上げた時に
 * 「別の接続が古いバージョンで掴んでいる」状態になり、更新が止まってしまう。 */
export async function addEventToAccount(account: OtherAccount, event: CalendarEvent): Promise<void> {
  const other = new LifeHubDB(account.dbName);
  try {
    await other.open();
    // idはここで振る。こちらの行のidをそのまま持ち込むと、別アカウントの行どうしが
    // 同じidを名乗ることになる。すぐ下のsyncQueueに積むのにも同じidが要るので、
    // 相手のDB任せ(schema.tsのcreatingフック)にせず自分で決める。
    const { id: _localId, ...fields } = event;
    const rowId = crypto.randomUUID();
    await other.calendarEvents.add({
      ...fields,
      id: rowId,
      userId: account.userId,
      deviceId: getDeviceId(),
    });
    await other.syncQueue.add({ table: "calendarEvents", rowId, op: "upsert", queuedAt: Date.now() });
  } finally {
    other.close();
  }
}
