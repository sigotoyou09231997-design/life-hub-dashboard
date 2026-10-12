/**
 * この端末で前にログインしたことがあるか。ログイン画面を「新規登録」と「ログイン」の
 * どちらから開くかだけに使う(src/pages/AuthGatePage.tsx)。ログアウトしても消さない —
 * 「前に使っていた端末」であることは変わらないため。
 */
const KEY = "lifehub.hasLoggedIn";

export function hasLoggedInBefore(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markLoggedIn() {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // 覚えられなくても、ログイン画面が「新規登録」から開くだけ
  }
}
