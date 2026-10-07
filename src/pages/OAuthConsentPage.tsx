import { useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "../components/ui/Button";
import {
  decideConsent,
  goTo,
  loadConsent,
  readAuthorizationId,
  redirectHost,
  takePendingConsent,
  type ConsentDetails,
} from "../lib/oauthConsent";

type View =
  | { kind: "loading" }
  | { kind: "consent"; details: ConsentDetails }
  | { kind: "working"; message: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

/**
 * 外のアプリ(ChatGPT)が、この LIFE HUB のアカウントに接続したい時の「許可しますか?」の画面
 * (src/lib/oauthConsent.ts)。Supabase の OAuth サーバーが、ログイン済みのこの人を、ここへ送ってくる。
 *
 * 「何ができるか」は、**MCP サーバー(api/mcp.ts)が実際にやること**だけを書く。やらないと決めて
 * いること(削除・上書き)は、その旨を書く。DB の側でも止める(supabase/sql/028_…)ので、守れる。
 */
export default function OAuthConsentPage() {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    // ログインの往復のために預けていた印は、ここまで戻れたら用済み。
    takePendingConsent();
    const authorizationId = readAuthorizationId(window.location.search);
    if (!authorizationId) {
      setView({ kind: "error", message: "接続の依頼が見つかりません。ChatGPT に戻って、もう一度「接続する」からやり直してください。" });
      return;
    }
    let active = true;
    void loadConsent(authorizationId).then((result) => {
      if (!active) return;
      if (result.kind === "redirect") {
        // すでに許可済みの接続。確認を挟まずに ChatGPT へ戻す。
        setView({ kind: "working", message: "ChatGPT に戻っています…" });
        goTo(result.url);
        return;
      }
      setView(result);
    });
    return () => {
      active = false;
    };
  }, []);

  async function decide(details: ConsentDetails, approve: boolean) {
    setView({ kind: "working", message: approve ? "接続しています…" : "断っています…" });
    try {
      const { redirectUrl, trusted } = await decideConsent(details.authorizationId, approve);
      if (!trusted) {
        setView({ kind: "done", message: "接続を断りました。このページは閉じて構いません。" });
        return;
      }
      goTo(redirectUrl);
    } catch (err) {
      console.error("[oauthConsent] could not complete the decision:", err);
      setView({
        kind: "error",
        message: approve
          ? "接続を完了できませんでした。ChatGPT に戻って、もう一度「接続する」からやり直してください。"
          : "断る操作を完了できませんでした。このページを閉じれば、接続はされません。",
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-10">
      {view.kind === "loading" || view.kind === "working" ? (
        <p className="flex items-center justify-center gap-2 text-sm text-slate-500" role="status" aria-live="polite">
          <Loader2 size={16} className="animate-spin" />
          {view.kind === "working" ? view.message : "接続の依頼を確かめています…"}
        </p>
      ) : view.kind === "error" || view.kind === "done" ? (
        <p className="text-center text-sm leading-relaxed text-slate-600" role={view.kind === "error" ? "alert" : "status"}>
          {view.message}
        </p>
      ) : (
        <Consent details={view.details} onDecide={(approve) => void decide(view.details, approve)} />
      )}
    </main>
  );
}

function Consent({ details, onDecide }: { details: ConsentDetails; onDecide: (approve: boolean) => void }) {
  const host = redirectHost(details.redirectUri) ?? "(不明)";
  return (
    <section className="space-y-5">
      <header className="space-y-2 text-center">
        <h1 className="text-lg font-semibold text-slate-800">「{details.clientName}」が LIFE HUB への接続を求めています</h1>
        <p className="text-xs leading-relaxed text-slate-500">
          接続するアカウント: <span className="font-medium text-slate-700">{details.email || "(このアカウント)"}</span>
        </p>
        <p className="text-xs leading-relaxed text-slate-500">
          接続先のサイト: <span className="font-mono font-medium text-slate-700">{host}</span>
        </p>
      </header>

      {!details.trusted && (
        <div className="flex gap-2 border border-red-200 bg-red-50/70 p-3 text-xs leading-relaxed text-red-700" role="alert">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <p>
            この接続の戻り先は、ChatGPT(chatgpt.com・openai.com)ではありません。名前は誰でも自由に付けられるので、
            心当たりがなければ、許可せずに閉じてください。この画面からは、許可できません。
          </p>
        </div>
      )}

      <div className="space-y-2 border border-white/60 bg-white/40 p-4">
        <p className="text-sm font-medium text-slate-700">許可すると、できること</p>
        <ul className="space-y-1.5 text-sm leading-relaxed text-slate-600">
          {[
            "旅行の一覧と、旅行ごとの日程を読む",
            "旅行を新しく作る",
            "旅行に日程を足す(あなたが入れた予定を、消したり書き換えたりはしません)",
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <Check size={15} className="mt-1 shrink-0 text-accent" />
              {line}
            </li>
          ))}
        </ul>
        <p className="pt-1 text-xs leading-relaxed text-slate-500">
          日記・家計・メモ・メールなど、旅行以外のデータは対象外です。接続は、LIFE HUB の「アカウント」画面の「接続しているアプリ」から、いつでも外せます。
        </p>
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={() => onDecide(false)}>
          許可しない
        </Button>
        <Button type="button" className="flex-1" disabled={!details.trusted} onClick={() => onDecide(true)}>
          許可する
        </Button>
      </div>
    </section>
  );
}
