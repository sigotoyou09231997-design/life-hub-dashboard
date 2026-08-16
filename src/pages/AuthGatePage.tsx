import { useState, type FormEvent } from "react";
import { auth, getRedirectUri } from "../lib/supabase";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { useToast } from "../components/ui/ToastProvider";

type Mode = "register" | "login";

/** Full-screen, no-header/no-nav gate rendered by App.tsx in place of the whole
 * app when there's no Supabase session — nothing (TOP, data, any route) is
 * reachable until the user registers or logs in. Session persistence itself
 * needs no extra work here: Supabase Auth persists to localStorage and
 * auto-refreshes (see src/lib/supabase.ts), so once past this screen the user
 * stays logged in on this device until they explicitly log out. */
export default function AuthGatePage() {
  const showToast = useToast();
  const [mode, setMode] = useState<Mode>("register");
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
    await auth.signInWithOAuth({ provider: "google", options: { redirectTo: getRedirectUri() } });
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
        <p className="mb-1 text-center text-lg font-semibold text-slate-900">LIFE HUB</p>
        <p className="mb-5 text-center text-xs text-slate-400">
          {mode === "register" ? "アカウントを登録してはじめましょう" : "ログインして続ける"}
        </p>

        <div className="mb-5 flex border border-white/45 bg-white/20 p-1">
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === "register" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            新規登録
          </button>
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            ログイン
          </button>
        </div>

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
      </Card>
    </div>
  );
}
