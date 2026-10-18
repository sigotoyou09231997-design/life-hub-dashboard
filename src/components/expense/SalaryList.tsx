import type { SalaryEntry } from "../../types";
import { formatShortDate, toDateStr } from "../../lib/date";
import { Trash2, Wallet } from "lucide-react";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { useConfirm } from "../ui/ConfirmProvider";

interface Props {
  salaries: SalaryEntry[];
  onEdit: (s: SalaryEntry) => void;
  onDelete: (id: string) => void;
}

function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  if (!year || !m) return month;
  return `${year}年${Number(m)}月`;
}

export function SalaryList({ salaries, onEdit, onDelete }: Props) {
  const confirm = useConfirm();

  if (salaries.length === 0) {
    return (
      <EmptyState icon={Wallet} title="給与がまだ登録されていません" description="下のボタンから登録できます。" />
    );
  }

  const sorted = [...salaries].sort((a, b) => b.month.localeCompare(a.month) || b.createdAt - a.createdAt);
  // 同じ月に複数ある時(追加の給与・ボーナスを同じ月に入れた時)は、どれがどれか分かるように登録日を添える(第8弾 M-4)。
  // 種類の区別はデータに無いので、登録日で見分ける。
  const perMonth = new Map<string, number>();
  for (const s of salaries) perMonth.set(s.month, (perMonth.get(s.month) ?? 0) + 1);

  return (
    <div className="space-y-2">
      {sorted.map((s) => (
        <ListRow key={s.id} interactive className="p-0">
          <button
            type="button"
            onClick={() => onEdit(s)}
            aria-label={`${formatMonth(s.month)}の給与を編集`}
            className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
          <div className="pointer-events-none relative z-10 flex items-center justify-between gap-3 p-3.5">
            <div>
              <span className="text-sm font-medium text-slate-900">{formatMonth(s.month)}</span>
              <p className="mt-0.5 text-xs text-slate-400">
                給料日: 毎月{s.payday}日
                {(perMonth.get(s.month) ?? 0) > 1 && <span className="ml-2">登録 {formatShortDate(toDateStr(new Date(s.createdAt)))}</span>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-900">¥{s.amount.toLocaleString()}</span>
              <button
                type="button"
                onClick={async () => {
                  if (s.id && (await confirm({ title: `「${formatMonth(s.month)}」の給与を削除しますか?` }))) {
                    onDelete(s.id);
                  }
                }}
                aria-label="削除"
                className="pointer-events-auto rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </ListRow>
      ))}
    </div>
  );
}
