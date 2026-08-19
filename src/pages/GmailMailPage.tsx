import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { db } from "../db/schema";
import { PageHeader } from "../components/ui/PageHeader";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { DraftReview } from "../components/gmail/DraftReview";

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

  // 一覧の「既読」フィルタータブ向け。readAtはstatus(AI下書き・送信ワークフローの進行状況)とは
  // 独立に、人間が実際にこの画面を開いたかどうかだけを表す。既に既読なら書き込まない。
  useEffect(() => {
    if (data?.email.id && !data.email.readAt) {
      void db.syncedEmails.update(data.email.id, { readAt: Date.now() });
    }
  }, [data?.email.id, data?.email.readAt]);

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
