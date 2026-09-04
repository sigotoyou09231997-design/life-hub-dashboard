/**
 * 「本当に消しますか?」をアプリの中のシートで聞く。
 *
 * これまでは全部ブラウザ標準の window.confirm だった。他の操作がすべて
 * アプリ内のシートなのに、削除の確認だけ OS のダイアログが出て浮いていた
 * (2026-09-04の本番確認)。加えて標準の confirm はページの実行を止めるので、
 * ブラウザの自動操作(Claude in Chrome など)から触ると後続の操作ごと固まる。
 *
 * 使い方は confirm とほぼ同じで、await を付けるだけ:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: `「${note.title}」を削除しますか?` }))) return;
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { FormActions } from "./FormActions";

export interface ConfirmOptions {
  /** シートの見出し。「〜しますか?」の一文をそのまま入れる。 */
  title: string;
  /** 見出しの下に出す補足。改行はそのまま行として出る。 */
  message?: string;
  /** 実行する側のボタン。既定は「削除する」。 */
  confirmLabel?: string;
  /** やめる側のボタン。既定は「キャンセル」。 */
  cancelLabel?: string;
  /** 消す操作でなければ "default"(青いボタン)にする。既定は "danger"。 */
  tone?: "danger" | "default";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  // 返事を待っている Promise の resolve。state に入れないのは、React が
  // 更新関数を2回呼ぶ場面(StrictMode)で二重に解決させないため。
  const pendingRef = useRef<((result: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // 前の問い合わせが残っていたら「やめる」で閉じる。待ちっぱなしの
        // Promise を作ると、呼んだ側の処理がそこで止まったままになる。
        pendingRef.current?.(false);
        pendingRef.current = resolve;
        setRequest(options);
      }),
    [],
  );

  const settle = useCallback((result: boolean) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setRequest(null);
    resolve?.(result);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Sheet open={request !== null} onClose={() => settle(false)} title={request?.title ?? ""}>
        {request && (
          <>
            {request.message && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{request.message}</p>
            )}
            <FormActions>
              <Button type="button" variant="secondary" onClick={() => settle(false)}>
                {request.cancelLabel ?? "キャンセル"}
              </Button>
              <Button
                type="button"
                variant={request.tone === "default" ? "primary" : "danger"}
                onClick={() => settle(true)}
              >
                {request.confirmLabel ?? "削除する"}
              </Button>
            </FormActions>
          </>
        )}
      </Sheet>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
