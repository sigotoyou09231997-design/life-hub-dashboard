import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 画面の表示でエラーが起きた時の受け皿(2026-11-21、本人「他のアプリに切り替えてまた戻ってきたら、白い画面になって動かない」)。
 *
 * これまでアプリ全体に受け皿が無く、どこか1か所の表示で例外が出ると React が画面ごと外して、白いまま何も起きなかった。
 * いちばん起きやすいのは、新しい版が出た直後: 版の切り替え(src/lib/pwaUpdate.ts)は、ほかのアプリへ移った瞬間に
 * 新しい Service Worker へ入れ替えるので、戻ってきた時に前の版のまま残っている画面が、後から読む画面のファイル
 * (前の版の名前の assets/…js)を取りに行くと、もうどこにも無い(取り置きは新しい版に入れ替わり、Vercel も今の版の
 * ファイルしか返さない)。読み込み直せば新しい版で開ける。
 *
 * - 画面のファイルが読めなかった時・それ以外のエラーの時とも、まず1回だけ読み込み直す(本人が開き直すのと同じ)。
 * - 読み込み直してから RETRY_GAP_MS 以内にまた起きたら、繰り返さずに理由とボタンを出す(白いままにしない)。
 * - 何が起きたかは CRASH_LOG_KEY に残す(次に聞かれた時に、その端末で確かめられるように)。
 */
export const CRASH_RELOAD_KEY = "lifehub:crash-reloaded-at";
export const CRASH_LOG_KEY = "lifehub:last-crash";
export const RETRY_GAP_MS = 60_000;

/** 後から読む画面のファイルが読めなかった(版の入れ替わり・通信切れ)時のエラーか。ブラウザごとに文言が違う。 */
export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed|Unable to preload CSS/i.test(
    text,
  );
}

/** 前に自動で読み込み直した時刻から、今回も読み込み直すか、あきらめて理由を出すか。 */
export function decideCrashRecovery(lastReloadAt: number | null, now: number): "reload" | "show" {
  if (lastReloadAt !== null && Number.isFinite(lastReloadAt) && now - lastReloadAt >= 0 && now - lastReloadAt < RETRY_GAP_MS) {
    return "show";
  }
  return "reload";
}

function readLastReload(): number | null {
  try {
    const raw = window.sessionStorage.getItem(CRASH_RELOAD_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function markReload(now: number): void {
  try {
    window.sessionStorage.setItem(CRASH_RELOAD_KEY, String(now));
  } catch {
    // 書けなくても読み込み直しはする
  }
}

function recordCrash(error: Error, info: ErrorInfo | null): void {
  try {
    window.localStorage.setItem(
      CRASH_LOG_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        path: window.location.pathname,
        message: `${error.name}: ${error.message}`.slice(0, 500),
        stack: (error.stack ?? "").slice(0, 1500),
        component: (info?.componentStack ?? "").slice(0, 1500),
      }),
    );
  } catch {
    // 残せなくても、立て直しはする
  }
}

interface Props {
  children: ReactNode;
  /** 読み込み直し(テストで差し替える)。 */
  reload?: () => void;
  /** 今の時刻(テストで差し替える)。 */
  now?: () => number;
}

interface State {
  error: Error | null;
  showReason: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, showReason: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[AppErrorBoundary] the screen crashed:", error, info.componentStack);
    recordCrash(error, info);
    const now = (this.props.now ?? Date.now)();
    if (decideCrashRecovery(readLastReload(), now) === "reload") {
      markReload(now);
      (this.props.reload ?? (() => window.location.reload()))();
      return;
    }
    this.setState({ showReason: true });
  }

  private reloadByHand = () => {
    try {
      window.sessionStorage.removeItem(CRASH_RELOAD_KEY);
    } catch {
      // 消せなくても読み込み直す
    }
    (this.props.reload ?? (() => window.location.reload()))();
  };

  private goHome = () => {
    window.location.assign("/");
  };

  render(): ReactNode {
    const { error, showReason } = this.state;
    if (!error) return this.props.children;
    if (!showReason) {
      // 読み込み直すまでの一瞬。白いままにせず、何をしているかだけ出す。
      return (
        <div className="boot-stall" role="status">
          <p className="boot-stall__note">読み込み直しています…</p>
        </div>
      );
    }
    const chunk = isChunkLoadError(error);
    return (
      <div className="boot-stall" role="alert">
        <p className="boot-stall__title">{chunk ? "新しい版への切り替えで、画面を読み込めませんでした" : "画面の表示でエラーが起きました"}</p>
        <p className="boot-stall__note">
          {chunk ? "通信が戻っていないかもしれません。読み込み直すと開けることが多いです。" : "読み込み直すか、ホームに戻ってください。続く時は、下の文字ごと知らせてください。"}
        </p>
        <p className="boot-stall__note" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
          {`${error.name}: ${error.message}`.slice(0, 200)}
        </p>
        <button type="button" className="boot-stall__button" onClick={this.reloadByHand}>
          読み込み直す
        </button>
        <button
          type="button"
          className="boot-stall__button"
          style={{ background: "transparent", color: "#1b5e57", boxShadow: "inset 0 0 0 1px #1b5e57" }}
          onClick={this.goHome}
        >
          ホームに戻る
        </button>
      </div>
    );
  }
}
