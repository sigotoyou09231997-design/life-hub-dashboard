/** この端末に登録したアカウントの一覧と、いま選んでいるアカウントの記録。
 *
 * このアプリの画面はどれも端末内(IndexedDB)を直接読んでいて、サーバーはその同期先に
 * すぎない。だから複数アカウントを同時に持つには「アカウントごとに別のIndexedDBを使う」
 * のが一番確実で、画面側のコードを一切変えずに済む。ここではその対応表 —
 * どのアカウントがどのDB名と、どの認証セッションの置き場所を使うか — だけを覚える
 * (実際の切り替え操作は src/lib/accountSwitch.ts)。
 *
 * このファイルが素のlocalStorageだけで、アプリ内の他のモジュールを一切importしないのは
 * 意図的: src/lib/supabase.ts と src/db/schema.ts の両方が、読み込みの一番最初(モジュール
 * 初期化時)にここを参照するため、どちらかに依存すると循環参照になる。 */

export interface StoredAccount {
  userId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** 認証セッション(Supabaseがlocalstorageに置くもの)の置き場所を分ける名前。
   * null は「このアプリが元から使っている既定の置き場所」= この機能より前から
   * ログインしていたアカウントの引き継ぎ先で、1端末につき最大1つ。 */
  slot: string | null;
  /** このアカウントのデータを入れるIndexedDBの名前。 */
  dbName: string;
  addedAt: number;
}

/** 既存ユーザーの端末に既にあるDB。最初に登録されたアカウントがそのまま引き継ぐ。 */
export const DEFAULT_DB_NAME = "life-hub";

/** アカウント追加のログイン中だけ使う、一時的なセッションの置き場所。ここへ入れておけば
 * 追加をやめたり失敗したりしても、いま使っているアカウントのログインを壊さない。 */
export const PENDING_SLOT = "pending";

const ACCOUNTS_KEY = "lifeHubAccounts";
const ACTIVE_KEY = "lifeHubActiveAccount";
const ADDING_KEY = "lifeHubAddingAccount";

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // プライベートモード等で書けなくても、いま開いているアカウントは動かしてよい。
  }
}

function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 同上。
  }
}

function isAccount(value: unknown): value is StoredAccount {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.userId === "string" &&
    typeof row.dbName === "string" &&
    (typeof row.slot === "string" || row.slot === null)
  );
}

/** 画面に出すアカウントの名前。表示名 → メール の順に使えるものを採る。 */
export function accountLabel(account: StoredAccount): string {
  return account.name ?? account.email ?? "アカウント";
}

/** この端末に登録済みのアカウント。追加した順に並ぶ。 */
export function listAccounts(): StoredAccount[] {
  const raw = readRaw(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAccount) : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: StoredAccount[]): void {
  writeRaw(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function findAccount(userId: string): StoredAccount | null {
  return listAccounts().find((account) => account.userId === userId) ?? null;
}

/** いま選んでいるアカウント。まだ何も登録していない端末では null。 */
export function getActiveAccount(): StoredAccount | null {
  const userId = readRaw(ACTIVE_KEY);
  const accounts = listAccounts();
  return (userId ? accounts.find((account) => account.userId === userId) : undefined) ?? accounts[0] ?? null;
}

export function setActiveAccount(userId: string): void {
  writeRaw(ACTIVE_KEY, userId);
}

export function isAddingAccount(): boolean {
  return readRaw(ADDING_KEY) === "1";
}

export function setAddingAccount(adding: boolean): void {
  if (adding) writeRaw(ADDING_KEY, "1");
  else removeRaw(ADDING_KEY);
}

/** 新しく登録するアカウントに割り当てるDB名。既定のDBがまだ誰のものでもなければ
 * それを使い(既存ユーザーの端末にあるデータをそのまま引き継ぐ)、埋まっていたら
 * ユーザーごとの名前にする。ユーザーIDから決まるので、一度ログアウトして入れ直しても
 * 同じDBに戻る。 */
function assignDbName(userId: string, accounts: StoredAccount[]): string {
  return accounts.some((account) => account.dbName === DEFAULT_DB_NAME) ? `${DEFAULT_DB_NAME}-${userId}` : DEFAULT_DB_NAME;
}

export interface AccountProfile {
  userId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

/** ログインしたアカウントを一覧に記録して、いま選んでいるアカウントにする。
 * 既に登録済みなら表示名・メール・アイコンだけ更新し、置き場所とDB名は変えない。 */
export function rememberAccount(profile: AccountProfile, slot: string | null): StoredAccount {
  const accounts = listAccounts();
  const existing = accounts.find((account) => account.userId === profile.userId);

  if (existing) {
    const updated: StoredAccount = {
      ...existing,
      email: profile.email ?? existing.email,
      name: profile.name ?? existing.name,
      avatarUrl: profile.avatarUrl ?? existing.avatarUrl,
      slot,
    };
    saveAccounts(accounts.map((account) => (account.userId === updated.userId ? updated : account)));
    setActiveAccount(updated.userId);
    return updated;
  }

  // 同じ置き場所を使っていた別アカウントは、そのセッションが今のログインで上書き
  // されている(= もうログイン状態を復元できない)ので一覧から外す。
  const remaining = accounts.filter((account) => account.slot !== slot);
  const created: StoredAccount = {
    userId: profile.userId,
    email: profile.email ?? null,
    name: profile.name ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    slot,
    dbName: assignDbName(profile.userId, remaining),
    addedAt: Date.now(),
  };
  saveAccounts([...remaining, created]);
  setActiveAccount(created.userId);
  return created;
}

/** 一覧から外す(端末内のそのアカウントのデータ自体は消さない — 同じアカウントで
 * 入れ直せば同じDBに戻る)。 */
export function forgetAccount(userId: string): void {
  saveAccounts(listAccounts().filter((account) => account.userId !== userId));
  if (readRaw(ACTIVE_KEY) === userId) removeRaw(ACTIVE_KEY);
}

/** 起動時に確定する値。アプリが動いている間の「今のアカウント」はここで固定される —
 * 切り替えは必ずページごと読み込み直すので(src/lib/accountSwitch.ts)、途中で変わらない。 */
const bootAccount = getActiveAccount();

/** 追加ログインの最中は、いま使っているアカウントのセッションに触らないよう一時領域を使う。 */
export const IS_ADDING_ACCOUNT: boolean = isAddingAccount();
export const BOOT_SLOT: string | null = IS_ADDING_ACCOUNT ? PENDING_SLOT : (bootAccount?.slot ?? null);
export const BOOT_DB_NAME: string = bootAccount?.dbName ?? DEFAULT_DB_NAME;

/** localStorageのキーを、いま開いているアカウント専用にする。既定のDBを使っている
 * アカウント(＝この機能より前からの1つ目)は、今まで通りのキーのまま —
 * 更新しただけで同期カーソルや持ち主の記録が失われないようにするため。 */
export function scopedKey(base: string): string {
  return BOOT_DB_NAME === DEFAULT_DB_NAME ? base : `${BOOT_DB_NAME}:${base}`;
}
