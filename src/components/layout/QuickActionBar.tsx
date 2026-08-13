import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CalendarDays, CheckSquare, Wallet, StickyNote, Mail, type LucideIcon } from "lucide-react";
import { AllFeaturesSheet } from "./AllFeaturesSheet";

interface QuickAction {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string;
  color: string;
  activeBg: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: "schedule-calendar", label: "予定", icon: CalendarDays, to: "/schedule?view=calendar", color: "text-blue-500", activeBg: "bg-blue-50" },
  { key: "schedule-tasks", label: "タスク", icon: CheckSquare, to: "/schedule?view=list", color: "text-emerald-500", activeBg: "bg-emerald-50" },
  { key: "money", label: "収支", icon: Wallet, to: "/records/expense", color: "text-orange-500", activeBg: "bg-orange-50" },
  { key: "notes", label: "メモ", icon: StickyNote, to: "/records/notes", color: "text-violet-500", activeBg: "bg-violet-50" },
  { key: "gmail", label: "Gmail", icon: Mail, to: "/gmail", color: "text-pink-500", activeBg: "bg-pink-50" },
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

/** Global shortcut bar to the 5 major features, shown on every page at every
 * width (matches the approved reference — PC keeps it too, not just mobile).
 * Not a page-transition tab bar — quick add/manage/confirm access, per the
 * design brief. Stays fixed at 5 icons; anything beyond that lives in
 * AllFeaturesSheet via the grip handle. */
export function QuickActionBar() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeKey = useActiveQuickActionKey();

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30">
        <div className="mx-auto max-w-md px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2">
          <div className="glass-shell rounded-3xl">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="すべての機能"
              className="flex w-full items-center justify-center pb-1 pt-2"
            >
              <span className="h-1 w-9 rounded-full bg-slate-300/70" aria-hidden="true" />
            </button>
            <div className="grid grid-cols-5 gap-1 px-2 pb-2">
              {QUICK_ACTIONS.map(({ key, label, icon: Icon, to, color, activeBg }) => {
                const isActive = activeKey === key;
                return (
                  <Link
                    key={key}
                    to={to}
                    className={`flex flex-col items-center gap-1 rounded-2xl py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      isActive ? activeBg : ""
                    }`}
                  >
                    <Icon size={20} className={isActive ? color : "text-slate-400"} />
                    <span className={`text-[11px] font-medium ${isActive ? color : "text-slate-500"}`}>{label}</span>
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
