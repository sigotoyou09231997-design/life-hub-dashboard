import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../db/schema";
import { describeGmailConnectError, exchangeAuthorizationCode, GMAIL_OAUTH_STATE_KEY } from "../lib/gmail";
import { registerGmailAccountForPush } from "../lib/pushNotifications";
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

      try {
        const result = await exchangeAuthorizationCode(code);
        const tokens = {
          accessToken: result.accessToken,
          accessTokenExpiresAt: Date.now() + result.expiresIn * 1000,
          refreshToken: result.refreshToken,
          connectedAt: Date.now(),
          // 連携切れの印を下ろす。ここで消さないと、つなぎ直した直後の画面に
          // 「連携が切れています」の帯が残り、自動同期も止まったままになる。
          reauthRequiredAt: 0,
        };
        // 同じアドレスで連携し直した場合は、行を増やさず既存の行を上書きする。
        // 増やしていた頃は、古い行にぶら下がったメール・AI下書き・ブロックリストが
        // そのまま残り、TOPや通知の件数(全アカウント合算)が端末ごとに食い違っていた。
        const existing = await db.gmailAccounts.where("email").equals(result.email).first();
        if (existing?.id) {
          await db.gmailAccounts.update(existing.id, tokens);
        } else {
          await db.gmailAccounts.add({ email: result.email, ...tokens });
        }
        // バックグラウンド通知の側にも、いま受け取ったrefresh_tokenを渡す。これが無いと、
        // 一覧の取り込みだけ戻って通知は止まったまま — サーバー側は古い(失効した)トークンを
        // 持ち続けるため(src/lib/pushNotifications.ts の registerGmailAccountForPush)。
        // 通知を使っていない場合は、その中で何もせずに戻る。連携そのものはもう済んでいるので、
        // ここでの失敗で「連携に失敗しました」にはしない。
        await registerGmailAccountForPush({ email: result.email, refreshToken: result.refreshToken }).catch((error) => {
          console.error("[gmail] connected, but could not register the account for notifications:", error);
        });
        showToast(`${result.email} と${existing ? "つなぎ直しました" : "連携しました"}`);
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
