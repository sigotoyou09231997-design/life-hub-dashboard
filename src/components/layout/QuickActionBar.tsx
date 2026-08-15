import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, CheckSquare, Wallet, StickyNote, type LucideIcon } from "lucide-react";
import { AllFeaturesSheet } from "./AllFeaturesSheet";
import { GmailLogo } from "../gmail/GmailLogo";

type IconComponent = LucideIcon | typeof GmailLogo;

interface QuickAction {
  key: string;
  label: string;
  icon: IconComponent;
  /** Gmail's icon is already multicolor — it must never be tinted like the
   * plain-outline lucide icons the other 4 actions use. */
  tintIcon: boolean;
  to: string;
  color: string;
  underline: string;
}

// `underline` is spelled out as a literal bg-*-500 string (not derived from
// `color` at runtime) because Tailwind's build only generates classes it can
// see as literal text in source — a `.replace("text-", "bg-")` string would
// silently produce no CSS in the production build.
const QUICK_ACTIONS: QuickAction[] = [
  { key: "schedule-calendar", label: "予定", icon: CalendarDays, tintIcon: true, to: "/schedule?view=calendar", color: "text-blue-500", underline: "bg-blue-500" },
  { key: "schedule-tasks", label: "タスク", icon: CheckSquare, tintIcon: true, to: "/schedule?view=list", color: "text-emerald-500", underline: "bg-emerald-500" },
  { key: "money", label: "収支", icon: Wallet, tintIcon: true, to: "/records/expense", color: "text-orange-500", underline: "bg-orange-500" },
  { key: "notes", label: "メモ", icon: StickyNote, tintIcon: true, to: "/records/notes", color: "text-violet-500", underline: "bg-violet-500" },
  // Gmailの実際のロゴ(マルチカラー)を使う。他4つと違い常時ブランド色そのままで、
  // アクティブ時もアイコン自体は着色しない(ラベル文字と下線だけ赤くする)。
  { key: "gmail", label: "Gmail", icon: GmailLogo, tintIcon: false, to: "/gmail", color: "text-red-500", underline: "bg-red-500" },
];

/** pathname alone can't tell 予定 and タスク apart — both live on /schedule —
 * so the `view` query param (see SchedulePage.tsx) breaks the tie. Pages with
 * no 1:1 mapping (TOP, 旅行, アカウント, 設定) intentionally highlight nothing. */
function useActiveQuickActionKey(): string | null {
  const { pathname, search } = useLocation();
  if (pathname === "/schedule") {
    return new URLSearchParams(search).get("view") === "list" ? "schedule-tasks" : "schedule-calendar";
  }
  if (pathname.startsWith("/records/expense")) return "money";
  if (pathname.startsWith("/records/notes")) return "notes";
  if (pathname.startsWith("/gmail")) return "gmail";
  return null;
}

/** Mobile navigation. Desktop uses DesktopSidebar instead. */
export function QuickActionBar() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeKey = useActiveQuickActionKey();

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
            <div className="grid grid-cols-5 gap-1 px-2 pb-2">
              {QUICK_ACTIONS.map(({ key, label, icon: Icon, tintIcon, to, color, underline }) => {
                const isActive = activeKey === key;
                return (
                  <Link
                    key={key}
                    to={to}
                    className="relative flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    {/* アイコンは選択有無に関わらず常にブランドカラー(未選択でも薄いグレーにしない)。
                        Gmailのロゴだけは元から多色なので着色しない。 */}
                    <Icon size={20} className={tintIcon ? color : ""} />
                    <span className={`text-[11px] font-medium ${isActive ? `${color} font-semibold` : "text-slate-500"}`}>{label}</span>
                    {isActive && <span className={`absolute -bottom-0.5 h-0.5 w-6 rounded-full ${underline}`} aria-hidden="true" />}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <AllFeaturesSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
