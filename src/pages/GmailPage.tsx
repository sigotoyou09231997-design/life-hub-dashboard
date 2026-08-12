import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { db } from "../db/schema";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { EmptyState } from "../components/ui/EmptyState";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { GmailInbox } from "../components/gmail/GmailInbox";
import { useDelayedFlag } from "../hooks/useDelayedFlag";

export default function GmailPage() {
  const navigate = useNavigate();
  const accounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const showSkeleton = useDelayedFlag(accounts === undefined);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

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
                  value={selectedAccountId ?? ""}
                  onChange={(v) => setSelectedAccountId(v)}
                  dense
                />
              </div>
            )}
            {selectedAccount && <GmailInbox account={selectedAccount} />}
          </>
        )}
      </div>
    </div>
  );
}
