import { Link } from "react-router-dom";
import { Check, ChevronRight, UserPlus } from "lucide-react";
import { accountLabel, listAccounts, type StoredAccount } from "../../lib/accounts";
import { startAddAccount, switchToAccount } from "../../lib/accountSwitch";
import { avatarColor, avatarInitial } from "../../lib/gmail";
import { Sheet } from "../ui/Sheet";

interface Props {
  open: boolean;
  onClose: () => void;
  /** いまログイン中のアカウント。一覧の中でこれだけチェックが付く。 */
  activeUserId?: string;
}

// 名前の決め方は lib 側と揃える(予定の複製先の表示にも同じものを使う)。
export { accountLabel };

export function AccountAvatar({ account, size = 40 }: { account: StoredAccount; size?: number }) {
  const label = accountLabel(account);
  const style = { width: size, height: size };
  return account.avatarUrl ? (
    <img src={account.avatarUrl} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  ) : (
    <div
      style={style}
      className={`flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(label)}`}
    >
      {avatarInitial(label)}
    </div>
  );
}

/** ヘッダーのアイコンから開く、アカウントの切り替え。登録済みのアカウントを選ぶと
 * そのアカウントのデータでアプリが開き直る — 端末内のデータはアカウントごとに
 * 分かれて残っているので、切り替えても消えないし同期を待つ必要もない
 * (仕組みは src/lib/accounts.ts)。 */
export function AccountSwitcher({ open, onClose, activeUserId }: Props) {
  const accounts = listAccounts();

  return (
    <Sheet open={open} onClose={onClose} title="アカウント">
      <div className="space-y-2">
        {accounts.map((account) => {
          const isActive = account.userId === activeUserId;
          return (
            <button
              key={account.userId}
              type="button"
              onClick={() => (isActive ? onClose() : switchToAccount(account.userId))}
              aria-current={isActive ? "true" : undefined}
              className="glass-row flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors active:bg-white/70"
            >
              <AccountAvatar account={account} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{accountLabel(account)}</p>
                <p className="truncate text-xs text-slate-500">{account.email ?? "—"}</p>
              </div>
              {isActive ? (
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                  <Check size={15} />
                  使用中
                </span>
              ) : (
                <span className="shrink-0 text-xs text-slate-400">切り替える</span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={startAddAccount}
          className="glass-row flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors active:bg-white/70"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/60 text-slate-500">
            <UserPlus size={18} />
          </div>
          <span className="flex-1 text-sm font-medium text-slate-900">アカウントを追加</span>
        </button>

        <Link
          to="/account"
          onClick={onClose}
          className="glass-row flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors active:bg-white/70"
        >
          <span className="flex-1 text-sm font-medium text-slate-900">アカウント設定を開く</span>
          <ChevronRight size={18} className="shrink-0 text-slate-300" />
        </Link>
      </div>
    </Sheet>
  );
}
