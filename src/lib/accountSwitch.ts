import type { Session } from "@supabase/auth-js";
import {
  BOOT_SLOT,
  PENDING_SLOT,
  findAccount,
  forgetAccount,
  getActiveAccount,
  listAccounts,
  rememberAccount,
  setActiveAccount,
  setAddingAccount,
  type AccountProfile,
} from "./accounts";
import { auth, clearStoredSession, moveStoredSession } from "./supabase";

/** 切り替え・追加・ログアウトのどれかで restart() を呼んだ後、実際にページが
 * 開き直るまでの一瞬だけ true。この間もこのページのJSは動き続けているため、
 * トークン自動更新などで src/App.tsx の onAuthStateChange がもう一度発火すると
 * rememberSignedInAccount → setActiveAccount が古いアカウントIDで上書きし、
 * 切り替えたはずのアカウントが開き直った先で元に戻ることがあった(2026-09-27、
 * 発生がタイミング次第で「時々切り替わらない」という報告になっていた)。
 * App.tsx はこれを見て、その一瞬に届いた分の反映を止める。 */
let restarting = false;

export function isRestarting(): boolean {
  return restarting;
}

/** アカウントを切り替えたら、必ずページごと読み込み直す。
 *
 * 画面もGmail連携も設定も、すべて端末内のIndexedDBを直接読んでいる(48ファイル)。
 * 動いているアプリの下でDBを差し替えると、開いたままの購読や描画途中の一覧が古い方の
 * DBを掴んだままになる。起動し直せばその心配が丸ごと無くなるし、切り替え先のデータは
 * もう端末内にあるので待ち時間もほぼ無い。 */
function restart(): void {
  restarting = true;
  window.location.replace("/");
}

function profileOf(session: Session): AccountProfile {
  const metadata = session.user.user_metadata as Record<string, unknown> | undefined;
  const name = typeof metadata?.full_name === "string" ? metadata.full_name : null;
  const avatarUrl = typeof metadata?.avatar_url === "string" ? metadata.avatar_url : null;
  return { userId: session.user.id, email: session.user.email ?? null, name, avatarUrl };
}

/** ログイン中のアカウントを、この端末の一覧に記録する。初めてなら置き場所とDB名を
 * 割り当てる — この機能より前から使っている端末では、そのまま既定のDBを引き継ぐ。 */
export function rememberSignedInAccount(session: Session): void {
  rememberAccount(profileOf(session), BOOT_SLOT);
}

/** 「アカウントを追加」。一度読み込み直して、追加用の一時領域でログインし直す
 * (いま開いているアカウントのセッションには触らない)。 */
export function startAddAccount(): void {
  setAddingAccount(true);
  restart();
}

/** 追加をやめて、元のアカウントに戻る。 */
export function cancelAddAccount(): void {
  setAddingAccount(false);
  restart();
}

/** 追加用のログインが成立したところで呼ぶ。一時領域に入った新しいセッションを
 * そのアカウント専用の置き場所へ移し、一覧に加えて、そのアカウントで開き直す。 */
export function finishAddAccount(session: Session): void {
  const existing = findAccount(session.user.id);
  // 既に登録済みのアカウントを追加し直した場合は、そのアカウントの置き場所を新しい
  // セッションで上書きするだけ(重複した行は増やさない)。
  const slot = existing ? existing.slot : session.user.id;
  moveStoredSession(PENDING_SLOT, slot);
  rememberAccount(profileOf(session), slot);
  setActiveAccount(session.user.id);
  setAddingAccount(false);
  restart();
}

export function switchToAccount(userId: string): void {
  if (getActiveAccount()?.userId === userId) return;
  setActiveAccount(userId);
  restart();
}

/** いま開いているアカウントだけログアウトする。他に登録済みのアカウントがあれば
 * そちらへ切り替わり、無ければログイン画面に戻る。端末内のそのアカウントのデータは
 * 残す(今までのログアウトと同じ) — 同じアカウントで入り直せばそのまま続きから使える。 */
export async function signOutActiveAccount(): Promise<void> {
  const active = getActiveAccount();
  try {
    await auth.signOut();
  } finally {
    if (active) {
      forgetAccount(active.userId);
      clearStoredSession(active.slot);
    }
    const next = listAccounts()[0];
    if (next) setActiveAccount(next.userId);
    restart();
  }
}
