import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { db } from "../db/schema";
import { PageHeader } from "../components/ui/PageHeader";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { DraftReview } from "../components/gmail/DraftReview";
import { pullBlockedSenders } from "../lib/blockedSenders";

/** Opened as its own browser tab (window.open, see GmailInbox.tsx) rather than
 * an in-app Sheet, so a long email can be read full-size and independently of
 * the inbox list tab it was opened from. */
export default function GmailMailPage() {
  const { emailId } = useParams<{ emailId: string }>();

  // undefined = still loading, null = email/account not found (e.g. bad/stale link).
  const data = useLiveQuery(async () => {
    if (!emailId) return null;
    const email = await db.syncedEmails.get(emailId);
    if (!email) return null;
    const account = await db.gmailAccounts.get(email.accountId);
    if (!account) return null;
    return { email, account };
  }, [emailId]);

  // 開いただけでは既読にしない(2026-08-23) — 既読は必ず本人がボタンを押した時だけ。
  // 既読にする操作は一覧のチェックボタンと、この画面のDraftReview内のボタンの2つ。

  // このページは一覧(GmailPage)を経由せず単独のタブとして開かれるので、そちらと同じ
  // ブロックリストの取り込みをここでも行う — DraftReviewのブロックボタンの状態
  // (ブロック済みかどうか)が他端末での操作を反映していないままになるのを防ぐ。
  useEffect(() => {
    if (data?.account.id) void pullBlockedSenders(data.account.id, data.account.email);
  }, [data?.account.id, data?.account.email]);

  return (
    <div className="mx-auto max-w-[1240px] pb-10 lg:pb-8">
      <PageHeader title="メール" onBack={() => window.close()} />
      <div className="px-5 lg:px-8">
        {data === undefined ? (
          <ListSkeleton />
        ) : data === null ? (
          <EmptyState
            icon={Mail}
            title="メールが見つかりません"
            description="このタブを閉じて、一覧からもう一度開いてください"
          />
        ) : (
          <DraftReview email={data.email} account={data.account} />
        )}
      </div>
    </div>
  );
}
