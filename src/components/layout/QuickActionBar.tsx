import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { AllFeaturesSheet } from "./AllFeaturesSheet";
import { getQuickAction, loadQuickActionKeys, saveQuickActionKeys, type QuickActionKey } from "./quickActions";
import { pushQuickActions, supabaseQuickActionRemote, syncQuickActions } from "./quickActionsSync";
import { useToast } from "../ui/ToastProvider";
import { useHiddenFeatures } from "../../hooks/useHiddenFeatures";
import { isPathHidden } from "../../lib/hiddenFeatures";

function useActiveQuickActionKey(): QuickActionKey | null {
  const { pathname } = useLocation();
  if (pathname === "/") return "home";
  if (pathname === "/schedule") return "schedule";
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
  // 設定の「使う機能」で隠した機能は、並びに残したまま出さない(オンに戻せば、元の位置に出る)。全部隠れたら、ホームだけ出す。
  const hidden = useHiddenFeatures();
  const visibleKeys = selectedKeys.filter((key) => !isPathHidden(getQuickAction(key).to, hidden));
  const actions = (visibleKeys.length > 0 ? visibleKeys : (["home"] as QuickActionKey[])).map(getQuickAction);
  // 今いる画面がナビに無い時(ナビから外したメモ・ふりかえり・設定など)は「すべて」を
  // 光らせる。どれも光らないと現在地が分からなかった(UI/UX 調査メモ A-2)。
  // ホームだけは別 — ナビに無ければヘッダーの家の印が光る(AppHeader.tsx、第2弾 S-2)。
  const allActive = activeKey !== "home" && (activeKey === null || !visibleKeys.includes(activeKey));

  // 並びはアカウントに紐づけて、別の端末にも同じにする(quickActionsSync.ts)。開いた時と、
  // アプリに戻った時に、サーバーの並びと突き合わせる。通信できない時は、端末の中の並びのまま。
  useEffect(() => {
    let alive = true;
    const sync = () => {
      void syncQuickActions(supabaseQuickActionRemote).then((next) => {
        if (alive && next) setSelectedKeys(next);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function handleSave(next: QuickActionKey[]) {
    const saved = saveQuickActionKeys(next);
    setSelectedKeys(saved);
    void pushQuickActions(saved, supabaseQuickActionRemote);
    showToast("下のナビを更新しました");
  }

  return (
    <>
      {/* Mobile sits flush with the true viewport bottom (bottom-0) per explicit
          request — safe-area clearance for the home indicator is handled by the
          inner pb-[...env(safe-area-inset-bottom)...] padding below, not by this
          offset. md:bottom-6 (desktop) is untouched, still mirroring the app
          shell's own md:my-6 bottom margin (App.tsx) so it nests just above the
          shell's rounded bottom corner there.
          transform-gpu promotes this to its own compositor layer: iOS Safari
          occasionally fails to keep a plain `position: fixed` element pinned to
          the viewport during a fast scroll when it (or a descendant, here
          .glass-nav's backdrop-filter blur) is compositing-heavy — the bar
          visibly detaches and sits wherever the scroll left it until something
          nudges a repaint. Forcing the layer ahead of time avoids that. */}
      {/* bottom に引く --viewport-gap は src/lib/viewport.ts。iOSがキーボードを閉じた後に
          画面の高さを戻し損ねている間、fixed は「短いままの画面」の下端に貼りつき、この
          バーが画面の途中で止まって見える。その足りない分だけ下へ伸ばして辻褄を合わせる。
          普段は0pxなので、これまでと同じ位置。 */}
      <div className="fixed inset-x-0 bottom-[calc(-1*var(--viewport-gap,0px))] z-30 transform-gpu lg:hidden">
        <div className="mx-auto max-w-md px-2 pb-[env(safe-area-inset-bottom)] pt-2">
          <div className="glass-nav">
            {/* 全機能シートの入口は、前はナビの上の細いつまみだけで、押せると気づきにくかった
                (UI/UX 調査メモ A-2)。いまは右端の「すべて」。入れ替えはできない固定の1つ。 */}
            <nav
              aria-label="追従ナビゲーション"
              className="grid gap-1 px-2 pb-2 pt-2"
              style={{ gridTemplateColumns: `repeat(${actions.length + 1}, minmax(0, 1fr))` }}
            >
              {actions.map(({ key, label, icon: Icon, tintIcon, to, color, underline }) => {
                const isActive = activeKey === key;
                return (
                  <Link
                    key={key}
                    to={to}
                    className={`relative flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${isActive ? "is-active" : ""}`}
                  >
                    <Icon size={20} className={tintIcon ? color : ""} />
                    <span className={`text-[11px] font-medium ${isActive ? `${color} font-semibold` : "text-slate-500"}`}>{label}</span>
                    {isActive && <span className={`absolute -bottom-0.5 h-0.5 w-6 rounded-full ${underline}`} aria-hidden="true" />}
                  </Link>
                );
              })}
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label="すべての機能"
                className={`relative flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${allActive ? "is-active" : ""}`}
              >
                <LayoutGrid size={20} />
                <span className="text-[11px] font-medium text-slate-500">すべて</span>
              </button>
            </nav>
          </div>
        </div>
      </div>
      <AllFeaturesSheet open={sheetOpen} onClose={() => setSheetOpen(false)} selectedKeys={selectedKeys} onSave={handleSave} />
    </>
  );
}
