import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { useToast } from "../ui/ToastProvider";

/**
 * 「日時が確定した」メールをカレンダーに自動で入れるかの切り替え(src/lib/mailAutoEvent.ts)。
 * 未設定はON。切っても、すでに入った予定は消えない。
 */
export function AutoEventToggle() {
  const showToast = useToast();
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const enabled = settings?.autoEventEnabled !== false;

  async function toggle() {
    if (!settings?.id) return;
    const next = !enabled;
    await db.settings.update(settings.id, { autoEventEnabled: next });
    showToast(next ? "確定した予定を自動で入れます" : "確定した予定の自動入力を止めました");
  }

  return (
    <div className="my-3 flex items-start justify-between gap-3 px-1">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">確定した予定を自動で入れる</div>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          「面接日程が確定しました」のように、日時が決まったと書かれたメール(3日以内に届いたもの)を、確認なしでカレンダーに入れます。
          入れた予定には元のメールへのリンクが付きます。候補を並べて選ばせるメールは入れません。
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={enabled}
        aria-label="確定した予定の自動入力を切り替え"
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
