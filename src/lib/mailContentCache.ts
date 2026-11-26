import type { GmailAccount } from "../types";
import { ensureFreshAccessToken, getMessageContent } from "./gmail";
import { IS_DEMO } from "./demoMode";
import { demoMailContent } from "./demoMail";

/**
 * メール本文を、開く前に取っておくための控え(2026-11-21、本人「メールの内容とかも時間かかってると思う」)。
 *
 * 以前は、メールを開いてから(アクセストークンの確認→Gmail から本文を取る、の順に)取っていたので、押してから
 * 本文が出るまで毎回、通信の往復ぶん待った。同じメールを開き直しても、毎回取り直していた。
 * いまは次の2つで待ちを減らす。
 *  - 一覧で指を置いた・マウスを乗せた時点で、本文を取りに行く(押して画面が開くまでの間に取り終わる)。
 *  - 一覧が出たあと、新しい未読の数通は、手が空いた時に先に取っておく(src/components/gmail/GmailInbox.tsx)。
 *
 * **控えるのはこの画面を開いている間だけ**(メモリの中。再読み込みで消える)。端末の保存領域(Dexie など)には
 * 書かない — 「一覧が持つのは抜粋だけ。本文・HTML・画像は保存しない」という決め事のまま
 * (src/components/gmail/MailBody.tsx)。先読みしても既読にはならない(既読は、本人がメールを開いた時だけ)。
 */
type Content = Awaited<ReturnType<typeof getMessageContent>>;

/** 控える通数と、中身の大きさ(文字数)の上限。同封画像が data: で入るメールは大きいので、数も大きさも絞る。 */
const MAX_ENTRIES = 30;
const MAX_TOTAL_CHARS = 8_000_000;

interface Entry {
  promise: Promise<Content>;
  /** 取り終わったら、中身の大きさ。まだなら 0。 */
  size: number;
}

const cache = new Map<string, Entry>();

function keyOf(account: Pick<GmailAccount, "id" | "email">, gmailMessageId: string): string {
  return `${account.id ?? account.email}\u0000${gmailMessageId}`;
}

function sizeOf(content: Content): number {
  let size = content.text.length + content.html.length;
  for (const value of Object.values(content.inlineImages)) size += value.length;
  return size;
}

/** 古いものから捨てる(Map は入れた順に並ぶ。使うたびに入れ直すので、先頭が一番使っていないもの)。 */
function trim(): void {
  let total = 0;
  for (const entry of cache.values()) total += entry.size;
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_ENTRIES && total <= MAX_TOTAL_CHARS) break;
    // 取っている最中のものは捨てない(取り終わるまで大きさが分からず、使っている画面が待っているため)。
    if (entry.size === 0) continue;
    cache.delete(key);
    total -= entry.size;
  }
}

/** メール1通の本文(文章・HTML・同封画像)。控えがあればそれ、取っている最中ならその結果を待つ。 */
export function loadMailContent(account: GmailAccount, gmailMessageId: string): Promise<Content> {
  // デモでは Gmail から取らず、見本の本文を出す(src/lib/demoMail.ts)。
  if (IS_DEMO) return Promise.resolve(demoMailContent(gmailMessageId));
  const key = keyOf(account, gmailMessageId);
  const hit = cache.get(key);
  if (hit) {
    // 使ったので、捨てる順番を後ろへ回す。
    cache.delete(key);
    cache.set(key, hit);
    return hit.promise;
  }
  const entry: Entry = {
    size: 0,
    promise: (async () => {
      const fresh = await ensureFreshAccessToken(account);
      return getMessageContent(fresh.accessToken, gmailMessageId);
    })(),
  };
  cache.set(key, entry);
  entry.promise.then(
    (content) => {
      entry.size = Math.max(1, sizeOf(content));
      trim();
    },
    // 失敗は控えない。次に開いた時にもう一度取りに行く。
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return entry.promise;
}

/** 開く前に取っておく。失敗しても何も出さない(開いた時に、普通に取りに行く)。 */
export function prefetchMailContent(account: GmailAccount, gmailMessageId: string): void {
  if (!gmailMessageId) return;
  loadMailContent(account, gmailMessageId).catch(() => undefined);
}

/** ログアウト・アカウントの解除・テスト用。 */
export function clearMailContentCache(): void {
  cache.clear();
}
