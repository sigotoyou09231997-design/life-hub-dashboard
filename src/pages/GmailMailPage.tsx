import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Navigate, useParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { db } from "../db/schema";
import { AREA_ACCENT_STYLE } from "../lib/areaColors";
import { PageHeader } from "../components/ui/PageHeader";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { DraftReview } from "../components/gmail/DraftReview";
import { pullBlockedSendersIfDue } from "../lib/blockedSenders";
import { pullMessageStates } from "../lib/gmailMessageState";
import { useIsDesktop } from "../hooks/useIsDesktop";

/** メール1通ぶんの画面(/gmail/mail/:id)。通知一覧・ホーム・全体検索・予定の元メールからも
 * このURLで開く。
 *
 * PC(lg以上)では、一覧の右側に開く形(/gmail?mail=<id>、GmailPage)へ置き換える
 * (2026-10-12 の見直し P-3)。PCは横幅があるので、一覧を見ながら読めるようにするため。
 * 置き換え(replace)なので、ブラウザの「戻る」は開く前の画面へ戻る。 */
export default function GmailMailPage() {
  const { emailId } = useParams<{ emailId: string }>();
  const isDesktop = useIsDesktop();
  if (isDesktop && emailId) return <Navigate to={`/gmail?mail=${encodeURIComponent(emailId)}`} replace />;
  return <GmailMailScreen emailId={emailId} />;
}

/** スマホ: 一覧(GmailInbox)から同じタブで開く、画面いっぱいのメール1通。
 *
 * 狭い画面では一覧の横に並べるペインや下からのシートに入れると、長い本文とAI返信文の
 * 編集欄が狭い枠に押し込まれるため、独立したページにしてある。戻ると一覧の絞り込み・
 * 検索語・スクロール位置はそのまま(GmailInbox.tsx の rememberedView)。 */
function GmailMailScreen({ emailId }: { emailId: string | undefined }) {
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

  // 通知一覧やブックマークから直に開かれると、一覧(GmailPage)を通らない。そちらと同じ
  // ブロックリストの取り込みをここでも行う — DraftReviewのブロックボタンの状態
  // (ブロック済みかどうか)が他端末での操作を反映していないままになるのを防ぐ。
  useEffect(() => {
    if (data?.account.id) void pullBlockedSendersIfDue(data.account.id, data.account.email);
  }, [data?.account.id, data?.account.email]);

  // 他端末で既読にした/未読に戻した分をこの画面にも反映する(一覧側は同期のたびに
  // 取り込むが、このページは一覧を通らずに開かれることがあるので自前で呼ぶ)。
  useEffect(() => {
    if (data?.account.id) void pullMessageStates(data.account.id, data.account.email);
  }, [data?.account.id, data?.account.email]);

  return (
    <div className="mx-auto max-w-[1240px] pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.gmail}>
      <PageHeader title="メール" backTo="/gmail" />
      <div className="px-5 lg:px-8">
        {data === undefined ? (
          <ListSkeleton />
        ) : data === null ? (
          <EmptyState
            icon={Mail}
            title="メールが見つかりません"
            description="一覧に戻って、もう一度開いてください"
          />
        ) : (
          <DraftReview email={data.email} account={data.account} />
        )}
      </div>
    </div>
  );
}
