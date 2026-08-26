import { db } from "../db/schema";
import { scopedKey } from "./accounts";

/** 端末内(IndexedDB)のデータが「どのログインユーザーのものか」の記録。
 * 記録もカーソルも、いま開いているアカウントのDB単位(src/lib/accounts.ts の scopedKey)。
 * アカウントごとにDBが分かれた今、下の入れ替え検知が実際に働くのは、一覧から消えた
 * アカウントのDB名が別のユーザーに割り当て直された場合だけになった。 */
const OWNER_KEY = scopedKey("lifeHubDataOwner");

/** src/lib/sync.ts の reconcile が使う差分pullカーソル。持ち主が変わったら消さないと、
 * 新しいユーザーの初回pullが「前の持ち主が最後に同期した時刻以降」の差分だけになり、
 * それより古い自分のデータがサーバーにあっても降りてこない。 */
const SYNC_CURSOR_PREFIX = scopedKey("lifeHubLastSynced:");

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // プライベートモード等で書けなくても、同期そのものは続行してよい。
  }
}

/** IndexedDBは「ブラウザごと」で、Supabaseのログインユーザーとは無関係に残り続ける。
 * 同期対象のテーブルはRLSで他人の行が降りてこないだけで、前の持ち主がこの端末に
 * 書いたローカル行はそのまま残るし、Gmail(アカウント接続・メール・AI下書き)や設定は
 * そもそも同期対象外なので、別アカウントでログインし直しても前のアカウントの中身が
 * まるごと見えてしまう。持ち主が変わったらローカルを空にしてから同期を始める。 */
async function wipeLocalData(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
  try {
    const stale = Object.keys(localStorage).filter((key) => key.startsWith(SYNC_CURSOR_PREFIX));
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // カーソルを消せなくてもデータ自体は空になっているので、致命的ではない。
  }
}

/** ログイン直後・同期開始前に呼ぶ。持ち主が変わっていた場合だけローカルを空にして true を返す。
 *
 * 記録が無い場合(この機能より前から使っている端末)は、今のローカルデータは今ログイン
 * している本人のものとみなして消さない — ここで消すと、既存ユーザーが更新後に一度だけ
 * 端末内のGmail連携や未同期のデータを失うことになるため。 */
export async function ensureDataOwner(userId: string): Promise<boolean> {
  const previous = readOwner();
  if (previous === userId) return false;
  if (previous === null) {
    writeOwner(userId);
    return false;
  }
  await wipeLocalData();
  writeOwner(userId);
  return true;
}
