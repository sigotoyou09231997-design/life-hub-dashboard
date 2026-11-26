import { IS_DEMO } from "../../lib/demoMode";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { useToast } from "../ui/ToastProvider";

/**
 * 返事のいらないメール(求人の案内・広告など)を、同期で自動的に既読にするかの切り替え(src/lib/mailAutoTriage.ts)。
 * 未設定はON。切っても、すでに既読にしたメールは未処理に戻らない(既読タブから見られる)。
 */
export function AutoTriageToggle() {
  const showToast = useToast();
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const enabled = settings?.autoTriageEnabled !== false;

  async function toggle() {
    if (!settings?.id) return;
    const next = !enabled;
    await db.settings.update(settings.id, { autoTriageEnabled: next });
    showToast(next ? "返事のいらないメールを自動で既読にします" : "返事のいらないメールの自動の既読を止めました");
  }

  return (
    <div className="my-3 flex items-start justify-between gap-3 px-1">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">返事のいらないメールを自動で既読にする</div>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          {IS_DEMO ? (
            // デモ(/demo)の例は、就活ではない一般的なものにする(2026-11-27)。
            <>
              お店の「おすすめ」「新着のお知らせ」、ポイント・セールの広告などを、未処理に残さず既読にします(既読タブで見られます)。
              予約・配達・支払いの知らせや、知り合いからのメッセージは片付けません。
            </>
          ) : (
            <>
              求人サイトの「おすすめ求人」「新着求人」、自動で届くオファーの知らせ、ポイント・セールの広告などを、未処理に残さず既読にします(既読タブで見られます)。
              面接・選考・書類・日程や、応募先の企業からのメッセージは片付けません。
            </>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label="返事のいらないメールの自動の既読を切り替え"
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 ${
          enabled ? "bg-accent" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
