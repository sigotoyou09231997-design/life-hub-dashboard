import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../db/schema";
import { describeGmailConnectError, exchangeAuthorizationCode, GMAIL_OAUTH_STATE_KEY } from "../lib/gmail";
import { CALENDAR_ENABLE_AFTER_CONNECT_KEY, GOOGLE_CALENDAR_SCOPE, syncGoogleCalendar } from "../lib/googleCalendar";
import { useToast } from "../components/ui/ToastProvider";

/** Landing page for Google's OAuth redirect (/gmail/callback). Exchanges the
 * authorization code for tokens, saves the account, then returns to Settings. */
export default function GmailCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const ranRef = useRef(false);
  const [status, setStatus] = useState<"working" | "error">("working");
  // 失敗の理由。トーストは数秒で消えてしまい、設定を直す手がかりが残らないので
  // 画面にも出したままにする。
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    async function run() {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const expectedState = sessionStorage.getItem(GMAIL_OAUTH_STATE_KEY);
      sessionStorage.removeItem(GMAIL_OAUTH_STATE_KEY);

      if (searchParams.get("error")) {
        showToast("Googleでの認証がキャンセルされました", "error");
        navigate("/settings", { replace: true });
        return;
      }
      if (!code || !state || !expectedState || state !== expectedState) {
        setStatus("error");
        // 同じタブで開き直した/別のタブに戻ってきた場合など、行きと帰りで
        // sessionStorage が繋がっていないと起きる。
        setReason(
          !expectedState
            ? "この画面を開いたタブに、連携を始めた時の情報が残っていません。設定画面から、同じタブでもう一度お試しください"
            : "認証情報の確認に失敗しました。設定画面からもう一度お試しください",
        );
        return;
      }

      // 設定画面の「つなぎ直してカレンダーも許可する」から来た時の控え。1回使ったら捨てる。
      const calendarEmail = sessionStorage.getItem(CALENDAR_ENABLE_AFTER_CONNECT_KEY);
      sessionStorage.removeItem(CALENDAR_ENABLE_AFTER_CONNECT_KEY);

      try {
        const result = await exchangeAuthorizationCode(code);
        const grantedScopes = result.scope ?? "";
        // 同意画面でカレンダーの権限を外されていたら入にしない(入にしても取り込めない)。
        const enableCalendar =
          calendarEmail?.toLowerCase() === result.email.toLowerCase() &&
          grantedScopes.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
        const tokens = {
          accessToken: result.accessToken,
          accessTokenExpiresAt: Date.now() + result.expiresIn * 1000,
          refreshToken: result.refreshToken,
          connectedAt: Date.now(),
          // 連携切れの印を下ろす。ここで消さないと、つなぎ直した直後の画面に
          // 「連携が切れています」の帯が残り、自動同期も止まったままになる。
          reauthRequiredAt: 0,
          grantedScopes,
          // 入にする時は起点を捨てて、この時点からの変更だけを取り込む(src/lib/googleCalendar.ts)。
          ...(enableCalendar ? { calendarSyncEnabledAt: Date.now(), calendarSyncToken: undefined, calendarSyncError: "" } : {}),
        };
        // 同じアドレスで連携し直した場合は、行を増やさず既存の行を上書きする。
        // 増やしていた頃は、古い行にぶら下がったメール・AI下書き・ブロックリストが
        // そのまま残り、TOPや通知の件数(全アカウント合算)が端末ごとに食い違っていた。
        const existing = await db.gmailAccounts.where("email").equals(result.email).first();
        let accountId = existing?.id;
        if (existing?.id) {
          await db.gmailAccounts.update(existing.id, tokens);
        } else {
          accountId = await db.gmailAccounts.add({ email: result.email, ...tokens });
        }
        if (enableCalendar && accountId) {
          // 起点を取るところまでここで済ませる。取り込み自体はホーム・予定の画面を開いた時に走る。
          const saved = await db.gmailAccounts.get(accountId);
          if (saved) void syncGoogleCalendar(saved);
        }
        showToast(
          `${result.email} と${existing ? "つなぎ直しました" : "連携しました"}${enableCalendar ? "。Googleカレンダーの取り込みを始めます" : ""}`,
        );
        navigate("/settings", { replace: true });
      } catch (error) {
        console.error("[gmail] failed to connect an account:", error);
        setStatus("error");
        setReason(describeGmailConnectError(error));
      }
    }

    run();
  }, [searchParams, navigate, showToast]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-5 text-center">
      <p className="text-sm text-slate-500">
        {status === "working" ? "Gmailと連携しています…" : "連携に失敗しました"}
      </p>
      {status === "error" && (
        <>
          <p className="max-w-md text-xs leading-relaxed text-slate-500">{reason}</p>
          <button
            type="button"
            onClick={() => navigate("/settings", { replace: true })}
            className="app-button rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            設定に戻る
          </button>
        </>
      )}
    </div>
  );
}
