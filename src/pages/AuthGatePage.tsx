import { useState, type FormEvent } from "react";
import { auth, getRedirectUri } from "../lib/supabase";
import { cancelAddAccount } from "../lib/accountSwitch";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useToast } from "../components/ui/ToastProvider";
import { Tabs } from "../components/ui/Tabs";
import { hasLoggedInBefore } from "../lib/loginMemory";

type Mode = "register" | "login";

interface Props {
  /** 「アカウントを追加」から来た場合。ログイン先が今のアカウントではなく2つ目に
   * なるので、見出しと戻り口だけ差し替える(認証のやり方そのものは同じ)。 */
  addingAccount?: boolean;
}

/** Full-screen, no-header/no-nav gate rendered by App.tsx in place of the whole
 * app when there's no Supabase session — nothing (TOP, data, any route) is
 * reachable until the user registers or logs in. Session persistence itself
 * needs no extra work here: Supabase Auth persists to localStorage and
 * auto-refreshes (see src/lib/supabase.ts), so once past this screen the user
 * stays logged in on this device until they explicitly log out. */
export default function AuthGatePage({ addingAccount = false }: Props) {
  const showToast = useToast();
  // 前にこの端末でログインしたことがあれば「ログイン」から開く(UI/UX 調査メモ)。
  // ふだん使う人はログインする方が多く、毎回「新規登録」から切り替えていた。
  const [mode, setMode] = useState<Mode>(addingAccount || hasLoggedInBefore() ? "login" : "register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register" && password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }

    setBusy(true);
    try {
      if (mode === "register") {
        const { data, error: signUpError } = await auth.signUp({ email, password });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        // メール確認が有効なSupabaseプロジェクトではsignUp直後にsessionが返らない
        // (確認リンクを踏むまでログイン状態にならない) — App.tsx側のonAuthStateChangeが
        // 自動でゲートを解除するので、ここでは「送信しました」の表示だけして待つ。
        if (!data.session) {
          setConfirmationSent(true);
        }
      } else {
        const { error: signInError } = await auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
          return;
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin() {
    await auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getRedirectUri(),
        // 追加のときは、Google側で「どのアカウントか」を必ず選ばせる — そうしないと
        // 今ログインしているのと同じアカウントのまま素通りしてしまう。
        ...(addingAccount ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
  }

  if (confirmationSent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5">
        <Card className="w-full max-w-sm text-center">
          <p className="mb-1 text-lg font-semibold text-slate-900">確認メールを送信しました</p>
          <p className="text-sm text-slate-500">{email} 宛のメール内のリンクをクリックすると、ログインできるようになります。</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <Card className="w-full max-w-sm">
        <p className="mb-1 text-center text-lg font-semibold text-slate-900">
          {addingAccount ? "アカウントを追加" : "LIFE HUB"}
        </p>
        {!addingAccount && <p className="brand-tagline mb-2 text-center">くらしを、ひとつに。</p>}
        <p className="mb-5 text-center text-xs text-slate-400">
          {addingAccount
            ? "この端末にもう1つアカウントを追加します。今のアカウントはそのまま残り、いつでも切り替えられます。"
            : mode === "register"
              ? "アカウントを登録してはじめましょう"
              : "ログインして続ける"}
        </p>

        {/* 1つの溝に詰めた切り替えをやめ、ほかの画面と同じ1つずつのタブにする
            (ボタンを溝に詰めない本人の好み、UI/UX 調査メモ C-1)。 */}
        <Tabs<Mode>
          className="tabs-primary mb-5"
          options={[
            { value: "register", label: "新規登録" },
            { value: "login", label: "ログイン" },
          ]}
          value={mode}
          onChange={switchMode}
        />

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="メールアドレス"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="パスワード"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "register" && (
            <Input
              label="パスワード（確認）"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
            />
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "処理中..." : mode === "register" ? "登録する" : "ログイン"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          または
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <Button variant="secondary" className="w-full" onClick={() => void handleGoogleLogin().catch(() => showToast("ログインに失敗しました", "error"))}>
          Googleでログイン
        </Button>

        {addingAccount && (
          <button
            type="button"
            onClick={cancelAddAccount}
            className="mt-4 w-full text-center text-sm text-slate-500 underline-offset-2 hover:underline"
          >
            追加をやめて戻る
          </button>
        )}
      </Card>
    </div>
  );
}
