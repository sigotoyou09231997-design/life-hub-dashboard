/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppErrorBoundary,
  CRASH_LOG_KEY,
  CRASH_RELOAD_KEY,
  RETRY_GAP_MS,
  decideCrashRecovery,
  isChunkLoadError,
} from "./AppErrorBoundary";

function Boom({ error }: { error: Error }): never {
  throw error;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  // React が受け皿で受けた例外も console.error に出すので、テストの出力を汚さないよう黙らせる。
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("isChunkLoadError", () => {
  it("ブラウザごとの「画面のファイルが読めない」文言を見分ける", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/SettingsPage-abc.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true); // Safari・iPhone
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true); // Firefox
    expect(isChunkLoadError(new Error("Cannot read properties of null (reading 'length')"))).toBe(false);
  });
});

describe("decideCrashRecovery", () => {
  it("初めて、または前の読み込み直しから時間がたっていれば読み込み直す。直後にまた起きたら理由を出す", () => {
    expect(decideCrashRecovery(null, 10_000)).toBe("reload");
    expect(decideCrashRecovery(10_000, 10_000 + RETRY_GAP_MS - 1)).toBe("show");
    expect(decideCrashRecovery(10_000, 10_000 + RETRY_GAP_MS)).toBe("reload");
    expect(decideCrashRecovery(Number.NaN, 10_000)).toBe("reload");
  });
});

describe("AppErrorBoundary", () => {
  it("エラーが無ければ中身をそのまま出す", () => {
    render(
      <AppErrorBoundary>
        <p>ホーム</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("ホーム")).toBeTruthy();
  });

  it("画面のファイルが読めなかったら、白いままにせず1回だけ読み込み直す。何が起きたかを残す", () => {
    const reload = vi.fn();
    render(
      <AppErrorBoundary reload={reload} now={() => 50_000}>
        <Boom error={new TypeError("Importing a module script failed.")} />
      </AppErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CRASH_RELOAD_KEY)).toBe("50000");
    expect(screen.getByText("読み込み直しています…")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(CRASH_LOG_KEY)!).message).toContain("Importing a module script failed");
  });

  it("読み込み直した直後にまた起きたら、繰り返さずに理由とボタンを出す", async () => {
    sessionStorage.setItem(CRASH_RELOAD_KEY, "50000");
    const reload = vi.fn();
    render(
      <AppErrorBoundary reload={reload} now={() => 60_000}>
        <Boom error={new TypeError("Importing a module script failed.")} />
      </AppErrorBoundary>,
    );
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("新しい版への切り替えで、画面を読み込めませんでした");

    // 本人が押した時は、印を消して読み込み直す(次に起きた時にまた1回は自動で立て直せるように)。
    await userEvent.click(screen.getByRole("button", { name: "読み込み直す" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CRASH_RELOAD_KEY)).toBeNull();
  });

  it("それ以外のエラーでも同じ流れ。理由の文字を出す", () => {
    sessionStorage.setItem(CRASH_RELOAD_KEY, "50000");
    render(
      <AppErrorBoundary reload={vi.fn()} now={() => 60_000}>
        <Boom error={new TypeError("Cannot read properties of null (reading 'length')")} />
      </AppErrorBoundary>,
    );
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("画面の表示でエラーが起きました");
    expect(alert).toContain("reading 'length'");
    expect(screen.getByRole("button", { name: "ホームに戻る" })).toBeTruthy();
  });
});
