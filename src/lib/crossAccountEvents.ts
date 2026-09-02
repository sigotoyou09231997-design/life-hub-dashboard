import { LifeHubDB } from "../db/schema";
import type { CalendarEvent } from "../types";
import { BOOT_DB_NAME, accountLabel, listAccounts } from "./accounts";
import { getDeviceId } from "./deviceId";

/** 予定を入れられる、いま開いていない方のアカウント。 */
export interface OtherAccount {
  userId: string;
  dbName: string;
  label: string;
  email: string | null;
}

/** いま開いているアカウント以外で、この端末に登録済みのもの。1つも無ければ空 —
 * 予定フォームの複製欄は、この結果が空でない時だけ出す。
 *
 * 「いま自分がどのアカウントか」は、実際に開いているIndexedDBの名前(BOOT_DB_NAME)で
 * 判断する。切り替え用のポインタ(lifeHubActiveAccount)は、切り替えの直後や追加ログインの
 * 途中で、実際に開いているDBと食い違うことがあるため — 食い違うと、自分自身を複製先に
 * 出したり、逆に相手が1件も出てこなくなったりする。 */
export function listOtherAccounts(): OtherAccount[] {
  return listAccounts()
    .filter((account) => account.dbName !== BOOT_DB_NAME)
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
  /** この予定を開いた時点で、そのアカウントに既に入っていたか。チェックを外して
   * 保存した時に「取り下げる」のか「元から入っていない」のかを見分けるために持つ。 */
  existed: boolean;
}

export function emptyDrafts(accounts: OtherAccount[], title: string): Record<string, AccountEventDraft> {
  // 既定はオフ。ここをオンにすると、片方のアカウントだけに入れたい普段の予定まで
  // 黙って両方に増えてしまう。
  return Object.fromEntries(accounts.map((a) => [a.userId, { checked: false, title, edited: false, existed: false }]));
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

export interface AccountEventChanges {
  /** 入れる/直すアカウント。 */
  apply: PlannedAccountEvent[];
  /** 取り下げるアカウント(入っていたのにチェックを外した)。 */
  remove: OtherAccount[];
}

/** 保存時に相手のアカウントへ何をするかを決める。チェックが入っていれば入れる(既にあれば
 * 直す)、入っていたのに外されていれば取り下げる。予定名が空の行は上のタイトルを使う。 */
export function planAccountChanges(
  accounts: OtherAccount[],
  drafts: Record<string, AccountEventDraft>,
  mainTitle: string,
): AccountEventChanges {
  const apply: PlannedAccountEvent[] = [];
  const remove: OtherAccount[] = [];
  for (const account of accounts) {
    const draft = drafts[account.userId];
    if (!draft) continue;
    if (draft.checked) apply.push({ account, title: draft.title.trim() || mainTitle });
    else if (draft.existed) remove.push(account);
  }
  return { apply, remove };
}

/** 相手のアカウントのDBを開いて渡す。書き終わったら必ず閉じる — 開いたままにすると、
 * その後スキーマを上げた時に「別の接続が古いバージョンで掴んでいる」状態になり、
 * 更新が止まってしまう。
 *
 * 絶対にやってはいけないこと: いま開いているDBを相手として扱うこと。そうなると相手側へ
 * 入れたつもりの予定が自分のスケジュールに現れる。listOtherAccounts が同じ条件で弾いて
 * いるが、静かに自分のデータを汚すより失敗として画面に出す方がよいのでここでも止める。 */
async function withAccountDb<T>(account: OtherAccount, run: (db: LifeHubDB) => Promise<T>): Promise<T> {
  if (account.dbName === BOOT_DB_NAME) {
    throw new Error(`複製先がいま開いているアカウントと同じです (${account.dbName})`);
  }
  const other = new LifeHubDB(account.dbName);
  try {
    await other.open();
    return await run(other);
  } finally {
    other.close();
  }
}

/** 相手のアカウントに入っている「同じ予定」。無ければ null。 */
export async function findLinkedEvent(account: OtherAccount, linkId: string): Promise<CalendarEvent | null> {
  return withAccountDb(account, async (other) => {
    const found = await other.calendarEvents.where("linkId").equals(linkId).first();
    return found ?? null;
  });
}

/** 相手のアカウントのスケジュールに、この予定を反映する。同じ印(linkId)の予定が既に
 * あればそれを直し、無ければ新しく足す。
 *
 * 予定名だけは相手側の値を使う — 「面接」をこちらには会社名入りで、相手には会社名なしで
 * 置く、というのがこの機能の目的なので、日時や場所を直しても名前は上書きしない。
 *
 * 同期の仕掛け(src/lib/sync.ts の registerSyncedTable)は「いま開いているDB」のテーブルに
 * しか付いていないため、userId・deviceId の付与と syncQueue への積み込みは手で行う —
 * これが無いと、相手のアカウントに切り替えた時にその予定が他の端末へ上がらない。 */
export async function applyEventToAccount(
  account: OtherAccount,
  event: CalendarEvent,
  linkId: string,
  title: string,
): Promise<void> {
  await withAccountDb(account, async (other) => {
    // 「誰の予定か」(personIds)は持ち込まない。人の一覧はアカウントごとに別なので、
    // こちらのidを渡しても相手側では誰も指さない。外しておけば、相手のアカウントで
    // 付けた人はこちらを編集し直しても消えない(Dexieのupdateは渡した項目しか触らない)。
    const { id: _localId, personIds: _personIds, ...fields } = event;
    const existing = await other.calendarEvents.where("linkId").equals(linkId).first();
    if (existing?.id) {
      await other.calendarEvents.update(existing.id, {
        ...fields,
        id: existing.id,
        title,
        linkId,
        userId: account.userId,
        deviceId: getDeviceId(),
      });
      await queueForPush(other, existing.id);
      return;
    }
    // idはここで振る。こちらの行のidをそのまま持ち込むと、別アカウントの行どうしが
    // 同じidを名乗ることになる。すぐ下で同期に積むのにも同じidが要るので、相手のDB任せ
    // (schema.tsのcreatingフック)にせず自分で決める。
    const rowId = crypto.randomUUID();
    await other.calendarEvents.add({
      ...fields,
      id: rowId,
      title,
      linkId,
      userId: account.userId,
      deviceId: getDeviceId(),
    });
    await queueForPush(other, rowId);
  });
}

/** 相手のアカウントから、この予定を取り下げる(チェックを外して保存した時)。
 * 相手側に無ければ何もしない。 */
export async function removeEventFromAccount(account: OtherAccount, linkId: string): Promise<void> {
  await withAccountDb(account, async (other) => {
    const existing = await other.calendarEvents.where("linkId").equals(linkId).first();
    if (!existing?.id) return;
    await other.calendarEvents.delete(existing.id);
    await queueForPush(other, existing.id, "delete");
  });
}

/** 相手のDBの同期キューに積む。同じ行が既に並んでいたら操作だけ入れ替える
 * (src/lib/sync.ts の enqueue と同じ考え方)。 */
async function queueForPush(other: LifeHubDB, rowId: string, op: "upsert" | "delete" = "upsert"): Promise<void> {
  const existing = await other.syncQueue.where("[table+rowId]").equals(["calendar_events", rowId]).first();
  if (existing?.id) await other.syncQueue.update(existing.id, { op, queuedAt: Date.now() });
  else await other.syncQueue.add({ table: "calendar_events", rowId, op, queuedAt: Date.now() });
}
