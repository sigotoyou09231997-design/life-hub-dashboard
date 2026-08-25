import { db } from "../db/schema";
import type { GmailAccount } from "../types";
import {
  buildSyncSummary,
  ensureFreshAccessToken,
  generateDraftForEmail,
  getMessageMeta,
  isUnhandledEmail,
  listRecentMessageIds,
  NO_CHANGES_SUMMARY,
  mapWithConcurrency,
  parseSender,
  threadHasSentReplyAfter,
} from "./gmail";
import { pullMessageStates, pushPendingMessageStates } from "./gmailMessageState";
import { addEmailIfAbsent, dedupeSyncedEmails } from "./syncedEmails";

const SYNC_WINDOW_DAYS = 30;

/** 「Gmail側で直接返信されていないか」の確認を1回の同期で何件まで行うか、
 * そのうち何本まで同時にGmail APIへ投げるか。Gmail APIは1分あたりの利用量に
 * 上限があり、越えると403 RATE_LIMIT_EXCEEDEDで同期全体が失敗する。 */
const RECONCILE_PER_SYNC = 40;
const RECONCILE_CONCURRENCY = 4;

/** 1回の同期で新しく取り込むメールの上限。1通ごとに本文以外の情報を取りに行くため、
 * 連携し直した直後のように未取得が数百件ある端末では、ここを絞らないと上限に当たる。 */
const NEW_EMAILS_PER_SYNC = 120;

export interface GmailSyncResult {
  /** 「2件の新着メールしました」など、何が起きたかの1行。 */
  summary: string;
  /** 既読の共有だけ失敗した場合の理由。メールの取得自体は成功している。 */
  stateError: string | null;
  /** 同期そのものが失敗した場合の、画面にそのまま出せる文言。 */
  error: string | null;
}

/** 何が起きたか分からない「メールの取得に失敗しました」だけだと、端末ごとに一覧が
 * 揃わない時に原因を切り分けられない。よくある失敗(連携切れ)は次にやることまで書き、
 * それ以外は元のメッセージをそのまま出す。
 *
 * 連携切れが起きるのは、Google側でアクセスを取り消した場合のほか、Google Cloudの
 * OAuth同意画面が「テスト中」のままだと更新用トークンが7日で失効するため。 */
export function describeSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // 利用量超過は連携切れと同じ403で返ってくるが、対処はまったく違う(待てば直る)。
  // 連携切れの案内より先に判定する。
  if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded|RATE_LIMIT_EXCEEDED|\b429\b/i.test(raw)) {
    return "Gmailの利用制限に達しました。1分ほど待ってから、もう一度同期してください";
  }
  if (/invalid_grant|expired|revoked|\b40[13]\b/i.test(raw)) {
    return `Gmailの連携が切れています。設定 → Gmail連携 でつなぎ直してください (${raw})`;
  }
  return `メールの取得に失敗しました: ${raw}`;
}

/** Gmailの受信トレイに無くなったメールをこの端末からも消す(AI下書きも一緒に)。
 * `inboxIds` はその期間の受信トレイを最後まで数えきれた場合のみ渡ってくる —
 * 途中までのリストで消すと、まだ受信トレイにあるメールまで消えてしまう。 */
async function pruneMissingEmails(accountId: string, inboxIds: string[]): Promise<number> {
  const keep = new Set(inboxIds);
  const stale = (await db.syncedEmails.where("accountId").equals(accountId).toArray()).filter(
    (email) => email.id && !keep.has(email.gmailMessageId),
  );
  for (const email of stale) {
    const drafts = await db.draftReplies.where("emailId").equals(email.id!).toArray();
    for (const draft of drafts) await db.draftReplies.delete(draft.id!);
    await db.syncedEmails.delete(email.id!);
  }
  return stale.length;
}

/** 同じアカウントの同期を二重に走らせないための見張り。キーはアカウントID。
 *
 * 同期は互いを知らない複数の場所から呼ばれる — メール一覧を開いた瞬間の自動同期と、
 * ヘッダーの「今すぐ同期」(連携中の全アカウントを回る)。2本が同時に走ると、どちらも
 * 同期前の同じ一覧を読んで同じ「新着」を計算してしまう。
 *
 * コンポーネント内のrefではなくモジュール変数なのは、一覧(GmailInbox)とページ
 * (GmailPage)という別々の場所からの呼び出しどうしを止める必要があるため。 */
const inFlight = new Map<string, Promise<GmailSyncResult>>();

/** 1アカウントぶんのGmail同期。トーストやスピナーには触らず、何が起きたかを返すだけに
 * してある — メール一覧からも、全アカウントをまとめて回すページからも呼ぶため。 */
export function syncGmailAccount(account: GmailAccount): Promise<GmailSyncResult> {
  if (!account.id) return Promise.resolve({ summary: "", stateError: null, error: null });
  const running = inFlight.get(account.id);
  if (running) return running;
  const run = runSync(account, account.id).finally(() => inFlight.delete(account.id!));
  inFlight.set(account.id, run);
  return run;
}

async function runSync(account: GmailAccount, accountId: string): Promise<GmailSyncResult> {
  try {
    // Merge away any pre-existing duplicates (rows sharing a gmailMessageId) before
    // reading `existing` below — see dedupeSyncedEmails's own comment for how these
    // could have been created before the in-flight guard above existed.
    await dedupeSyncedEmails(accountId);

    // 自動下書きの要否とブロック中の送信者は、ここでDBから読む。画面から渡してもらって
    // いた頃は、一覧を開いているアカウントの分しか手元に無く、裏のアカウントを同期できなかった。
    const settings = await db.settings.toCollection().first();
    const autoDraftEnabled = settings?.autoDraftEnabled ?? false;
    const blockedSet = new Set(
      (await db.blockedSenders.where("accountId").equals(accountId).toArray()).map((b) => b.email),
    );

    const fresh = await ensureFreshAccessToken(account);
    const sinceEpochSec = Math.floor(Date.now() / 1000) - SYNC_WINDOW_DAYS * 24 * 60 * 60;
    const { ids, complete } = await listRecentMessageIds(fresh.accessToken, sinceEpochSec);
    const existing = await db.syncedEmails.where("accountId").equals(accountId).toArray();
    const known = new Set(existing.map((e) => e.gmailMessageId));
    // 未取得のメールが大量にある(連携し直した直後など)端末で、1回の同期に大量の
    // リクエストを投げて上限に当たらないよう、新しい方から少しずつ取り込む。
    // 残りは次の同期で取り込まれる。
    const pendingIds = ids.filter((id) => !known.has(id));
    const newIds = pendingIds.slice(0, NEW_EMAILS_PER_SYNC);
    const deferred = pendingIds.length - newIds.length;

    let added = 0;
    let failed = 0;
    // 取り込んだ行のid。既読の取り込み(後述のpullMessageStates)が済んだ時点で
    // 読み直し、そのうち何件が実際に一覧へ出るのかを数えるために持っておく。
    const addedIds: string[] = [];
    for (const id of newIds) {
      // 1通の取得失敗で同期全体を止めない。止めていた頃は、通信が不安定な端末だけ
      // 途中までしか取り込めず、PCとスマホで一覧の件数が食い違う原因になっていた。
      // 取り込めなかった分は保存されないので、次の同期でそのまま再挑戦される。
      let meta: Awaited<ReturnType<typeof getMessageMeta>>;
      try {
        meta = await getMessageMeta(fresh.accessToken, id);
      } catch {
        failed++;
        continue;
      }
      // ブロック中の送信者でも保存する。隠すのは表示時(visibleEmails)だけ —
      // ここで捨てていた頃は、後でブロックを解除しても30日窓/取得上限から外れた
      // メールがその端末にだけ戻らず、PCとスマホで一覧の中身がずれていた。
      const newEmail = {
        accountId,
        gmailMessageId: id,
        threadId: meta.threadId,
        from: meta.from,
        subject: meta.subject,
        snippet: meta.snippet,
        receivedAt: meta.receivedAt,
        status: "unprocessed" as const,
        createdAt: Date.now(),
      };
      // 存在確認と追加をまとめて行う。読んだ`known`は同期の開始時点のもので、その後に
      // 別のタブやアカウント統合(src/lib/gmailAccounts.ts)が同じメールを入れている
      // ことがある — そのまま足すと一覧に同じメールが二重で並ぶ。
      const newEmailId = await addEmailIfAbsent(newEmail);
      if (!newEmailId) continue;
      addedIds.push(newEmailId);
      added++;

      // 自動下書き: 送信は行わない。draftReplies を作成するところまでで、
      // 送信は必ずDraftReview側で本人が「送信する」を押した場合のみ。
      if (autoDraftEnabled && !blockedSet.has(parseSender(meta.from).email.toLowerCase())) {
        try {
          await generateDraftForEmail(account, { ...newEmail, id: newEmailId });
        } catch {
          // 同期自体は続行する — 個別メールの下書き生成失敗で全体を止めない。
        }
      }
    }
    // Gmail側とのズレ防止: このアプリの外(他デバイス・Gmail本体)から直接返信された
    // 場合、この app には知る手段がないため、まだ未送信扱いのトラッキング中メールは
    // 毎回スレッドの実際の状態と突き合わせて「送信済み」を確定させる。新規追加分より
    // 古いメールが対象なので、際限なく増え続けないようsinceEpochSecの範囲に限定する。
    // 1分あたりの上限に当たらないよう、確認する件数と同時に投げる本数を絞る。
    // 全件を Promise.all で一斉に投げていた頃は、メールの多い端末で同期のたびに
    // Gmail APIから 403 RATE_LIMIT_EXCEEDED が返っていた。ここで確認しきれなかった
    // 分は次回の同期に回る(新しいものから確認する)。
    const unresolvedExisting = existing
      .filter((e) => e.status !== "sent" && e.receivedAt >= sinceEpochSec * 1000)
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, RECONCILE_PER_SYNC);
    let reconciled = 0;
    await mapWithConcurrency(unresolvedExisting, RECONCILE_CONCURRENCY, async (e) => {
      if (!e.id) return;
      try {
        const actuallySent = await threadHasSentReplyAfter(fresh.accessToken, e.threadId, e.receivedAt);
        if (!actuallySent) return;
        const now = Date.now();
        const existingDraft = await db.draftReplies.where("emailId").equals(e.id).first();
        if (existingDraft?.id) {
          if (!existingDraft.sentAt) await db.draftReplies.update(existingDraft.id, { sentAt: now });
        } else {
          // 下書きレコード自体がない(=このアプリ経由で下書きを作らずGmail側で直接
          // 返信した)場合も作っておく — これがないとDraftReview側で「下書きなし」
          // 扱いとなり、送信済みなのに再度下書き作成・送信ができてしまう。
          await db.draftReplies.add({
            emailId: e.id,
            accountId,
            body: "(Gmail側で直接返信済み。このアプリの外で送信されたため、本文はここには保存されていません)",
            subject: e.subject,
            createdAt: now,
            updatedAt: now,
            sentAt: now,
          });
        }
        await db.syncedEmails.update(e.id, { status: "sent" });
        reconciled++;
      } catch {
        // 個別スレッドの確認失敗で同期全体を止めない。
      }
    });

    // Gmailの受信トレイ(直近SYNC_WINDOW_DAYS日)に無くなったメールをこの端末からも消す。
    // これが無いと、アーカイブ/削除された分や、片方の端末にだけ残っている古い分が
    // 端末ごとに溜まり続け、同じアカウントなのに一覧の面ぶれが揃わない。
    // completeがfalse(=取得上限まで辿っても数えきれなかった)時は、単に取得しきれて
    // いないだけのメールを消してしまうので掃除しない。
    const removed = complete ? await pruneMissingEmails(accountId, ids) : 0;

    // 既読の共有。まだ送っていないこの端末の既読(この機能より前の分を含む)を送ってから、
    // 他端末の分を取り込む。取り込みはメールを入れた後 — ローカルに行が無い
    // メッセージの状態は入れる場所が無いため。
    const pushedStates = await pushPendingMessageStates(accountId, account.email);
    const pulledStates = await pullMessageStates(accountId, account.email);

    // 「新着」として数えるのは、実際にこの一覧へ出るものだけにする。取り込んだ中には
    // 他の端末で既に読んだもの(既読タブへ入る)や、ブロック中の送信者のもの(どこにも
    // 出ない)が混ざる。以前はそれも含めて数えていたため、「7件の新着メールしました」と
    // 出るのに一覧には何も増えない、という食い違いが起きていた(2026-08-24)。
    // 数え直しは既読の取り込みが済んだ後に行う — 先に数えると、この直後に既読へ
    // 変わるものまで新着に入ってしまう。
    const addedRows = addedIds.length > 0 ? await db.syncedEmails.bulkGet(addedIds) : [];
    let blockedAdded = 0;
    let handledElsewhere = 0;
    for (const row of addedRows) {
      if (!row) continue;
      if (blockedSet.has(parseSender(row.from).email.toLowerCase())) blockedAdded++;
      else if (!isUnhandledEmail(row)) handledElsewhere++;
    }
    const freshAdded = added - blockedAdded - handledElsewhere;

    await db.gmailAccounts.update(accountId, { lastSyncedAt: Date.now() });
    return {
      summary: buildSyncSummary({
        freshAdded,
        handledElsewhere,
        blockedAdded,
        reconciled,
        removed,
        pushedStates: pushedStates.count,
        pulledStates: pulledStates.count,
        failed,
        deferred,
      }),
      stateError: pushedStates.error ?? pulledStates.error ?? null,
      error: null,
    };
  } catch (err) {
    return { summary: "", stateError: null, error: describeSyncError(err) };
  }
}

export interface AccountSyncOutcome {
  email: string;
  result: GmailSyncResult;
}

/** 全アカウントぶんの同期結果を、トースト1行にまとめる。
 *
 * トーストは同時に1つしか出せず、後から出したものが前のものを即座に消す
 * (ToastProvider)。アカウントごとに出すと最後の1件しか読めないため、ここで1行に
 * 畳んでから渡す。同じ理由で、以前は「既読の同期に失敗しました」を出した直後に
 * 成功トーストを出していて、その失敗が一度も表示されていなかった。
 *
 * アカウントが1つの時の文面は今までどおり。複数の時だけ、どのアカウントの話かが
 * 分かるよう@より前を頭に付ける — アドレス全文だと1行に収まらない。 */
export function summarizeGmailSync(
  outcomes: AccountSyncOutcome[],
): { message: string; tone: "success" | "error" } | null {
  if (outcomes.length === 0) return null;
  const tag = (email: string) => (outcomes.length > 1 ? `${email.split("@")[0]}: ` : "");

  const lines: string[] = [];
  let tone: "success" | "error" = "success";
  for (const { email, result } of outcomes) {
    if (result.error) {
      lines.push(`${tag(email)}${result.error}`);
      tone = "error";
    } else if (result.stateError) {
      // メールの取得自体は成功しているが、黙って端末間で既読が揃わないままになる方が
      // 実害が大きいので、件数の報告よりこちらを優先して出す。
      lines.push(`${tag(email)}既読の同期に失敗しました: ${result.stateError}`);
      tone = "error";
    } else if (result.summary && result.summary !== NO_CHANGES_SUMMARY) {
      // 何も起きなかったアカウントは行に出さない。全部それだと下の1行に畳まれる —
      // 「新着メールはありませんでした」がアカウントの数だけ並んでも読みにくいだけ。
      lines.push(`${tag(email)}${result.summary}`);
    }
  }
  if (lines.length === 0) {
    return outcomes.some((o) => o.result.summary) ? { message: NO_CHANGES_SUMMARY, tone: "success" } : null;
  }
  return { message: lines.join(" / "), tone };
}
