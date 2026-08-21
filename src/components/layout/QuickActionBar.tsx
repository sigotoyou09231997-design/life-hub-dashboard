import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AllFeaturesSheet } from "./AllFeaturesSheet";
import { getQuickAction, loadQuickActionKeys, saveQuickActionKeys, type QuickActionKey } from "./quickActions";
import { useToast } from "../ui/ToastProvider";

/** pathname alone can't tell 予定 and タスク apart — both live on /schedule —
 * so the `view` query param (see SchedulePage.tsx) breaks the tie. Pages with
 * so the `view` query param (see SchedulePage.tsx) breaks the tie. */
function useActiveQuickActionKey(): QuickActionKey | null {
  const { pathname, search } = useLocation();
  if (pathname === "/schedule") {
    return new URLSearchParams(search).get("view") === "list" ? "schedule-tasks" : "schedule-calendar";
  }
  if (pathname.startsWith("/records/expense")) return "money";
  if (pathname.startsWith("/records/notes")) return "notes";
  if (pathname.startsWith("/gmail")) return "gmail";
  if (pathname.startsWith("/trips")) return "trips";
  return null;
}

/** Mobile navigation. Desktop uses DesktopSidebar instead. */
export function QuickActionBar() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(loadQuickActionKeys);
  const activeKey = useActiveQuickActionKey();
  const showToast = useToast();
  const actions = selectedKeys.map(getQuickAction);

  function handleSave(next: QuickActionKey[]) {
    setSelectedKeys(saveQuickActionKeys(next));
    showToast("追従ボタンを更新しました");
  }

  return (
    <>
      {/* Mobile sits flush with the true viewport bottom (bottom-0) per explicit
          request — safe-area clearance for the home indicator is handled by the
          inner pb-[...env(safe-area-inset-bottom)...] padding below, not by this
          offset. md:bottom-6 (desktop) is untouched, still mirroring the app
          shell's own md:my-6 bottom margin (App.tsx) so it nests just above the
          shell's rounded bottom corner there. */}
      <div className="fixed inset-x-0 bottom-0 z-30 lg:hidden">
        <div className="mx-auto max-w-md px-2 pb-[env(safe-area-inset-bottom)] pt-2">
          <div className="glass-nav">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="すべての機能"
              className="flex w-full items-center justify-center pb-1 pt-2"
            >
              <span className="h-1 w-9 rounded-full bg-slate-300/70" aria-hidden="true" />
            </button>
            <nav
              aria-label="追従ナビゲーション"
              className="grid gap-1 px-2 pb-2"
              style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
            >
              {actions.map(({ key, label, icon: Icon, tintIcon, to, color, underline }) => {
                const isActive = activeKey === key;
                return (
                  <Link
                    key={key}
                    to={to}
                    className={`relative flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${isActive ? "is-active" : ""}`}
                  >
                    {/* アイコンは選択有無に関わらず常にブランドカラー(未選択でも薄いグレーにしない)。
                        Gmailのロゴだけは元から多色なので着色しない。 */}
                    <Icon size={20} className={tintIcon ? color : ""} />
                    <span className={`text-[11px] font-medium ${isActive ? `${color} font-semibold` : "text-slate-500"}`}>{label}</span>
                    {isActive && <span className={`absolute -bottom-0.5 h-0.5 w-6 rounded-full ${underline}`} aria-hidden="true" />}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>
      <AllFeaturesSheet open={sheetOpen} onClose={() => setSheetOpen(false)} selectedKeys={selectedKeys} onSave={handleSave} />
    </>
  );
}
