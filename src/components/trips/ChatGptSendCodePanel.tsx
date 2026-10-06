import { useEffect, useState } from "react";
import { Copy, ExternalLink, KeyRound } from "lucide-react";
import {
  CHATGPT_GPT_URL,
  createSendCode,
  loadSendCodeState,
  revokeSendCode,
  type SendCodeState,
} from "../../lib/chatgptInbox";
import { Button } from "../ui/Button";

type Confirming = "regenerate" | "revoke" | null;

/**
 * 専用GPTから LIFE HUB へ旅程を直接送るための「送信コード」の発行(supabase/sql/027_chatgpt_trip_inbox.sql)。
 *
 * コードは人ごとの印で、専用GPTに最初に伝えてもらう(GPTの設定は配った全員で1つなので、
 * 設定の鍵では誰のものか見分けられない)。コードでできるのは、自分の受信箱へ旅程を置くことだけ。
 * ログインしていない・SQLをまだ流していない時は、この部分ごと出さない(任意の機能のため)。
 */
export function ChatGptSendCodePanel() {
  const [state, setState] = useState<SendCodeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void loadSendCodeState().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!state || state.kind === "unavailable") return null;

  async function handleCreate() {
    setBusy(true);
    setConfirming(null);
    setMessage("");
    try {
      const code = await createSendCode();
      setState({ kind: "active", createdAt: new Date().toISOString(), code });
    } catch (err) {
      console.error("[chatgptInbox] failed to create a send code:", err);
      setMessage("送信コードを作れませんでした。通信を確かめて、もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    setConfirming(null);
    setMessage("");
    try {
      await revokeSendCode();
      setState({ kind: "none" });
      setMessage("送信コードを無効にしました。配ったコードは、もう受け付けません");
    } catch (err) {
      console.error("[chatgptInbox] failed to revoke the send code:", err);
      setMessage("無効にできませんでした。通信を確かめて、もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setMessage("コードをコピーしました。専用GPTの最初に貼り付けてください");
    } catch {
      setMessage("コピーできませんでした。コードを長押しして選んでください");
    }
  }

  const code = state.kind === "active" ? state.code : undefined;

  return (
    <div className="space-y-3 border-t border-white/60 pt-4" aria-label="ChatGPTから直接送る">
      <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <KeyRound size={16} />
        ChatGPTから直接送る(専用GPT)
      </p>
      <p className="text-xs leading-relaxed text-slate-500">
        専用GPTに送信コードを伝えると、GPTが作った旅程が、この画面の一番上に届きます。届いた旅程は、
        確かめてから日程に入れます。
      </p>

      {state.kind === "none" && (
        <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={handleCreate}>
          送信コードを作る
        </Button>
      )}

      {state.kind === "active" && (
        <>
          {code ? (
            <div className="space-y-2">
              <p className="select-all break-all border border-white/60 bg-white/50 px-3 py-2.5 text-center font-mono text-sm tracking-wider text-slate-800">
                {code}
              </p>
              <Button type="button" className="w-full" onClick={() => handleCopy(code)}>
                <Copy size={17} />
                コードをコピー
              </Button>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              送信コードは作ってあります。コードは作った端末でしか表示できないので、この端末で見たい時は
              「作り直す」を押してください(古いコードは使えなくなります)。
            </p>
          )}

          {confirming === null ? (
            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="flex-1" disabled={busy} onClick={() => setConfirming("regenerate")}>
                作り直す
              </Button>
              <Button type="button" variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirming("revoke")}>
                無効にする
              </Button>
            </div>
          ) : (
            <div className="space-y-2 border border-white/60 bg-white/40 p-3" role="alert">
              <p className="text-xs leading-relaxed text-slate-700">
                {confirming === "regenerate"
                  ? "新しいコードを作ると、今のコードはこの瞬間から使えなくなります。専用GPTには、新しいコードを伝え直してください。"
                  : "コードを無効にすると、専用GPTからは何も送れなくなります。もう一度使う時は、新しく作ります。"}
              </p>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setConfirming(null)}>
                  やめる
                </Button>
                <Button type="button" className="flex-1" disabled={busy} onClick={confirming === "regenerate" ? handleCreate : handleRevoke}>
                  {confirming === "regenerate" ? "作り直す" : "無効にする"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {CHATGPT_GPT_URL && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => window.open(CHATGPT_GPT_URL, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink size={17} />
          専用GPTを開く
        </Button>
      )}

      <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-slate-500">
        <li>専用GPTを開いて、最初に送信コードを伝える</li>
        <li>行き先や日数を話して、旅程を作ってもらう</li>
        <li>「LIFE HUBに送って」と頼む</li>
        <li>この画面(日程タブの「写真・文章から追加・更新」)の一番上に届くので、確かめて入れる</li>
      </ol>
      <p className="text-xs leading-relaxed text-slate-500">
        送信コードを知っている人は、あなたの受信箱に旅程を置けます(日程や日記は読めません)。
        他の人には見せないでください。
      </p>

      {message && (
        <p className="px-1 text-xs leading-relaxed text-slate-700" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
