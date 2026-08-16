import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../lib/supabase";
import { useToast } from "../components/ui/ToastProvider";

/** Landing page for Supabase's OAuth redirect (/auth/callback). Supabase's client
 * parses the session out of the URL on load, so this just waits for that to land
 * (via onAuthStateChange, with an immediate getSession() check in case it already
 * landed before this page mounted) and returns to Settings. */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const handledRef = useRef(false);
  const [status, setStatus] = useState<"working" | "error">("working");

  useEffect(() => {
    function handleSession(email: string | undefined) {
      if (handledRef.current) return;
      handledRef.current = true;
      showToast(`${email ?? "アカウント"}でログインしました`);
      navigate("/settings", { replace: true });
    }

    const { data: listener } = auth.onAuthStateChange((_event, session) => {
      if (session) handleSession(session.user.email);
    });

    auth.getSession().then(({ data }) => {
      if (data.session) handleSession(data.session.user.email);
    });

    const timeout = window.setTimeout(() => {
      if (!handledRef.current) {
        setStatus("error");
        showToast("ログインに失敗しました", "error");
      }
    }, 8000);

    return () => {
      listener.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [navigate, showToast]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-5 text-center">
      <p className="text-sm text-slate-500">
        {status === "working" ? "ログインしています…" : "ログインに失敗しました。設定画面に戻ってやり直してください。"}
      </p>
    </div>
  );
}
