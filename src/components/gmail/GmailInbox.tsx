import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Ban, Check, Mail, Search } from "lucide-react";
import { db } from "../../db/schema";
import type { EmailStatus, GmailAccount } from "../../types";
import {
  avatarColor,
  avatarInitial,
  ensureFreshAccessToken,
  generateDraftForEmail,
  getMessageMeta,
  listRecentMessageIds,
  parseSender,
  threadHasSentReplyAfter,
} from "../../lib/gmail";
import { formatGmailTimestamp } from "../../lib/date";
import { blockSenderRemote, unblockSenderRemote } from "../../lib/blockedSenders";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { ListRow } from "../ui/ListRow";
import { ListSkeleton } from "../ui/ListSkeleton";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/ToastProvider";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

interface Props {
  account: GmailAccount;
}

/** Lets GmailPage's header "今すぐ同期" button trigger this component's own
 * sync logic (which needs account/blockedSet state that lives here) without
 * lifting that whole fetch flow up a level. */
export interface GmailInboxHandle {
  sync: () => void;
  syncing: boolean;
}

const SYNC_WINDOW_DAYS = 30;

const STATUS_LABEL: Record<EmailStatus, string> = {
  unprocessed: "未処理",
  generating: "生成中",
  drafted: "下書きあり",
  edited: "編集済み",
  sent: "送信済み",
  skipped: "スキップ",
};

const STATUS_TONE: Record<EmailStatus, "neutral" | "accent" | "warning" | "success"> = {
  unprocessed: "neutral",
  generating: "accent",
  drafted: "accent",
  edited: "warning",
  sent: "success",
  skipped: "neutral",
};

export const GmailInbox = forwardRef<GmailInboxHandle, Props>(function GmailInbox({ account }, ref) {
  const showToast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "drafted" | "sent" | "read">("all");
  const [manageBlockedOpen, setManageBlockedOpen] = useState(false);

  const emails = useLiveQuery(
    () => (account.id ? db.syncedEmails.where("accountId").equals(account.id).reverse().sortBy("receivedAt") : []),
    [account.id],
  );
  const showSkeleton = useDelayedFlag(emails === undefined);

  const blockedSenders = useLiveQuery(
    () => (account.id ? db.blockedSenders.where("accountId").equals(account.id).toArray() : []),
    [account.id],
  );
  const blockedSet = new Set((blockedSenders ?? []).map((b) => b.email));

  // blockSenderRemote() is fire-and-forget (see src/lib/blockedSenders.ts) — if that
  // one push fails (offline, Supabase session not ready yet, transient error), the
  // sender stays blocked locally forever but never reaches checkGmailAndNotify.ts's
  // server-side filter, so background push notifications keep arriving for a sender
  // the app already shows as blocked. Re-upserting every locally-blocked sender each
  // time this list loads is a cheap, idempotent self-heal for that gap.
  useEffect(() => {
    if (!blockedSenders || blockedSenders.length === 0) return;
    for (const b of blockedSenders) void blockSenderRemote(account.email, b.email);
  }, [blockedSenders, account.email]);

  // Separate from any notification/push setting — this only controls whether
  // handleSync() below also generates an AI draft for each newly-found email.
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const autoDraftEnabled = settings?.autoDraftEnabled ?? false;

  const visibleEmails = emails?.filter((email) => !blockedSet.has(parseSender(email.from).email.toLowerCase()));

  const statusFilteredEmails = visibleEmails?.filter((email) => {
    if (statusFilter === "drafted") return email.status === "drafted" || email.status === "edited";
    if (statusFilter === "sent") return email.status === "sent";
    if (statusFilter === "read") return !!email.readAt;
    // "すべて": 既読にしたメールはここから外れる(=「既読」タブへ移動したように見える)。
    return !email.readAt;
  });

  const filteredEmails = statusFilteredEmails?.filter((email) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      email.from.toLowerCase().includes(q) ||
      email.subject.toLowerCase().includes(q) ||
      email.snippet.toLowerCase().includes(q)
    );
  });

  async function handleSync() {
    if (!account.id) return;
    setSyncing(true);
    try {
      const fresh = await ensureFreshAccessToken(account);
      const sinceEpochSec = Math.floor(Date.now() / 1000) - SYNC_WINDOW_DAYS * 24 * 60 * 60;
      const ids = await listRecentMessageIds(fresh.accessToken, sinceEpochSec);
      const existing = await db.syncedEmails.where("accountId").equals(account.id).toArray();
      const known = new Set(existing.map((e) => e.gmailMessageId));
      const newIds = ids.filter((id) => !known.has(id));

      let added = 0;
      for (const id of newIds) {
        const meta = await getMessageMeta(fresh.accessToken, id);
        if (blockedSet.has(parseSender(meta.from).email.toLowerCase())) continue;
        const newEmail = {
          accountId: account.id,
          gmailMessageId: id,
          threadId: meta.threadId,
          from: meta.from,
          subject: meta.subject,
          snippet: meta.snippet,
          receivedAt: meta.receivedAt,
          status: "unprocessed" as const,
          createdAt: Date.now(),
        };
        const newEmailId = await db.syncedEmails.add(newEmail);
        added++;

        // 自動下書き: 送信は行わない。draftReplies を作成するところまでで、
        // 送信は必ずDraftReview側で本人が「送信する」を押した場合のみ。
        if (autoDraftEnabled) {
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
      const unresolvedExisting = existing.filter((e) => e.status !== "sent" && e.receivedAt >= sinceEpochSec * 1000);
      let reconciled = 0;
      await Promise.all(
        unresolvedExisting.map(async (e) => {
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
                accountId: account.id!,
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
        }),
      );

      await db.gmailAccounts.update(account.id, { lastSyncedAt: Date.now() });
      const parts: string[] = [];
      if (added > 0) parts.push(`${added}件の新着メール`);
      if (reconciled > 0) parts.push(`${reconciled}件を送信済みに更新`);
      showToast(parts.length > 0 ? `${parts.join("・")}しました` : "新着メールはありませんでした");
    } catch {
      showToast("メールの取得に失敗しました", "error");
    } finally {
      setSyncing(false);
    }
  }

  useImperativeHandle(ref, () => ({ sync: handleSync, syncing }), [syncing, account, blockedSet]);

  // 画面を開いた瞬間に最新化する — ヘッダーの「今すぐ同期」は以降の手動リフレッシュ用として残す。
  useEffect(() => {
    void handleSync();
  }, [account.id]);

  async function handleUnblock(id: string, email: string) {
    await db.blockedSenders.delete(id);
    void unblockSenderRemote(account.email, email);
    showToast("ブロックを解除しました");
  }

  // 開かずに一覧から直接既読にできる(GmailMailPage.tsxを開いた時の自動既読化とは別の
  // 手動エントリポイント)。readAtは「すべて」タブの除外/「既読」タブの表示にも使われるため、
  // 押すとその場でこの一覧(「すべて」時)から消える。
  async function handleMarkRead(id: string) {
    await db.syncedEmails.update(id, { readAt: Date.now() });
    showToast("既読にしました");
  }

  return (
    // 他の一覧画面(メモ・収支等)と同じく、外側を1枚のglass-cardで包まない —
    // ページ自身のpx-5に直接乗せることで、各行(.glass-row)だけがカードに見える構成に
    // 揃える(以前はここにglass-card+p-4を重ねていたため、横方向のpaddingが他の
    // 一覧画面より大きく見えていた)。lg以上は高さを親グリッドに合わせて固定し、
    // リスト部分だけが内部スクロールする(検索・タブ・ブロック中リンクは常に見える)。
    // lg未満(モバイル)はflex-colのまま自然に積み重なり、ページ全体でスクロールする。
    <div className="mail-inbox flex flex-col gap-3 lg:h-full lg:min-h-0">
      {!showSkeleton && emails && emails.length > 0 && (
        <div className="relative shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="メールを検索"
          className="spatial-field w-full min-h-11 rounded-[2px] border border-white/55 bg-white/30 py-2.5 pl-9 pr-3.5 text-sm outline-none focus:border-accent/60 focus:bg-white/55 focus:ring-2 focus:ring-accent/15"
          />
        </div>
      )}

      {!showSkeleton && emails && emails.length > 0 && (
        <div className="flex shrink-0 gap-1.5" role="group" aria-label="ステータスフィルター">
          {(
            [
              ["all", "すべて"],
              ["drafted", "AI下書き"],
              ["sent", "送信済み"],
              ["read", "既読"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                statusFilter === value
                  ? "border-accent bg-accent-light text-accent"
                  : "border-white/50 text-slate-500 hover:border-white/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {blockedSenders && blockedSenders.length > 0 && (
        <button
          type="button"
          onClick={() => setManageBlockedOpen(true)}
          className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Ban size={13} />
          ブロック中の送信者({blockedSenders.length})
        </button>
      )}

      {showSkeleton ? (
        <ListSkeleton />
      ) : filteredEmails && filteredEmails.length > 0 ? (
        <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-0.5">
          {filteredEmails.map((email) => {
            const sender = parseSender(email.from);
            const unread = email.status === "unprocessed" && !email.readAt;
            return (
              // 「既読にする」ボタンをaの外(兄弟要素)に置くため、行全体を囲むdivとaに分けている
              // (button要素をa要素の中にネストするのはHTML的に不正で、挙動が環境依存になる)。
              <div
                key={email.id}
                className={`mail-row glass-row flex w-full items-stretch rounded-xl border-l-[3px] transition-colors ${unread ? "is-unread border-l-accent" : "border-l-transparent"}`}
              >
                <a
                  href={`/gmail/mail/${email.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 active:bg-white/60"
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(sender.email)}`}
                  >
                    {avatarInitial(sender.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate text-sm ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>
                        {sender.name}
                      </p>
                      <span className="shrink-0 text-xs text-slate-500">{formatGmailTimestamp(email.receivedAt)}</span>
                    </div>
                    <p className={`mt-0.5 truncate text-sm ${unread ? "font-medium text-slate-800" : "text-slate-600"}`}>
                      {email.subject}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{email.snippet}</p>
                    {email.status !== "unprocessed" && (
                      <div className="mt-1.5">
                        <Badge tone={STATUS_TONE[email.status]}>{STATUS_LABEL[email.status]}</Badge>
                      </div>
                    )}
                  </div>
                </a>
                {!email.readAt && (
                  <button
                    type="button"
                    onClick={() => email.id && handleMarkRead(email.id)}
                    aria-label="既読にする"
                    title="既読にする"
                    className="flex w-11 shrink-0 items-center justify-center text-slate-300 transition-colors active:bg-slate-100 active:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    <Check size={18} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : emails && emails.length > 0 ? (
        <EmptyState title="該当する結果が見つかりませんでした" description="検索条件を変えてみてください。" />
      ) : (
        <EmptyState
          icon={Mail}
          title="メールがありません"
          description="「今すぐ同期」を押すと直近30日分の受信メールを取得します"
        />
      )}

      <Sheet open={manageBlockedOpen} onClose={() => setManageBlockedOpen(false)} title="ブロック中の送信者">
        <div className="space-y-2">
          {(blockedSenders ?? []).map((b) => (
            <ListRow key={b.id} className="flex items-center justify-between py-2.5">
              <span className="min-w-0 truncate text-sm text-slate-700">{b.email}</span>
              <button
                type="button"
                onClick={() => b.id && handleUnblock(b.id, b.email)}
                className="shrink-0 text-xs font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                解除
              </button>
            </ListRow>
          ))}
        </div>
      </Sheet>
    </div>
  );
});
