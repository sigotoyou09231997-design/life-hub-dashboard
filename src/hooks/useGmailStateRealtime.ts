import { useEffect } from "react";
import { subscribeMessageStates } from "../lib/gmailMessageState";

/** 他の端末で付けたメールの既読・重要を、その場で受け取る(2026-11-23、本人「即時にしたい」)。
 *
 * Gmail の画面だけでなく、ホームの「重要」の数などにも効くよう、アプリ全体(App.tsx)で1本だけ張る。
 * userId は同期の準備が済んでから渡すこと — リアルタイムの接続にログインのトークンを渡すのは同期の開始(startSync)なので、
 * それより前に張ると、本人の行が1件も届かない。null の間(未ログイン・準備中・共有リンクの画面)は何もしない。 */
export function useGmailStateRealtime(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    subscribeMessageStates(userId)
      .then((stop) => {
        if (stopped) stop();
        else unsubscribe = stop;
      })
      .catch((error) => console.error("[gmailMessageState] failed to subscribe:", error));
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [userId]);
}
