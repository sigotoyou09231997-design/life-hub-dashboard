import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../db/schema";
import { exchangeAuthorizationCode, GMAIL_OAUTH_STATE_KEY } from "../lib/gmail";
import { useToast } from "../components/ui/ToastProvider";

/** Landing page for Google's OAuth redirect (/gmail/callback). Exchanges the
 * authorization code for tokens, saves the account, then returns to Settings. */
export default function GmailCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const ranRef = useRef(false);
  const [status, setStatus] = useState<"working" | "error">("working");

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
        showToast("認証情報の確認に失敗しました。もう一度お試しください。", "error");
        return;
      }

      try {
        const result = await exchangeAuthorizationCode(code);
        const tokens = {
          accessToken: result.accessToken,
          accessTokenExpiresAt: Date.now() + result.expiresIn * 1000,
          refreshToken: result.refreshToken,
          connectedAt: Date.now(),
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
        showToast(`${result.email} と${existing ? "つなぎ直しました" : "連携しました"}`);
        navigate("/settings", { replace: true });
      } catch {
        setStatus("error");
        showToast("Gmail連携に失敗しました", "error");
      }
    }

    run();
  }, [searchParams, navigate, showToast]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-5 text-center">
      <p className="text-sm text-slate-500">
        {status === "working" ? "Gmailと連携しています…" : "連携に失敗しました。設定画面に戻ってやり直してください。"}
      </p>
    </div>
  );
}
