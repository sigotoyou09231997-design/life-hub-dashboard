import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { db } from "../db/schema";
import type { SyncedEmail } from "../types";
import { PageHeader } from "../components/ui/PageHeader";
import { Sheet } from "../components/ui/Sheet";
import { Tabs } from "../components/ui/Tabs";
import { EmptyState } from "../components/ui/EmptyState";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { GmailInbox } from "../components/gmail/GmailInbox";
import { DraftReview } from "../components/gmail/DraftReview";
import { useDelayedFlag } from "../hooks/useDelayedFlag";

export default function GmailPage() {
  const navigate = useNavigate();
  const accounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const showSkeleton = useDelayedFlag(accounts === undefined);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [reviewingEmail, setReviewingEmail] = useState<SyncedEmail | null>(null);

  useEffect(() => {
    if (accounts && accounts.length > 0 && selectedAccountId == null) {
      setSelectedAccountId(accounts[0].id ?? null);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);

  return (
    <div className="pb-10">
      <PageHeader title="メール" subtitle="受信メールとAI下書き" backTo="/settings" />

      <div className="px-5">
        {showSkeleton ? (
          <ListSkeleton />
        ) : !accounts || accounts.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="Gmail未接続"
            description="設定画面からGmailアカウントを連携してください"
            action={{ label: "設定を開く", onClick: () => navigate("/settings") }}
          />
        ) : (
          <>
            {accounts.length > 1 && (
              <div className="mb-4">
                <Tabs
                  options={accounts.map((a) => ({ value: String(a.id), label: a.email }))}
                  value={String(selectedAccountId)}
                  onChange={(v) => setSelectedAccountId(Number(v))}
                  dense
                />
              </div>
            )}
            {selectedAccount && <GmailInbox account={selectedAccount} onOpenEmail={setReviewingEmail} />}
          </>
        )}
      </div>

      <Sheet open={reviewingEmail !== null} onClose={() => setReviewingEmail(null)} title="返信の確認">
        {reviewingEmail && selectedAccount && (
          <DraftReview email={reviewingEmail} account={selectedAccount} onSent={() => setReviewingEmail(null)} />
        )}
      </Sheet>
    </div>
  );
}
