import type { SalaryEntry } from "../../types";
import { aggregateDeductions } from "../../lib/salaryCsv";
import { Card } from "../ui/Card";
import { ProgressBar } from "../ui/ProgressBar";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  if (!year || !m) return month;
  return `${year}年${Number(m)}月`;
}

interface Props {
  salaries: SalaryEntry[];
}

export function SalaryDeductionBreakdown({ salaries }: Props) {
  if (salaries.length === 0) return null;

  const latest = [...salaries].sort((a, b) => b.month.localeCompare(a.month))[0];
  const latestDeductionTotal = latest.deductions?.reduce((sum, d) => sum + d.amount, 0);
  const aggregated = aggregateDeductions(salaries);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          最新の給与({formatMonth(latest.month)})
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-slate-500">総支給額</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
              {latest.grossAmount != null ? yen(latest.grossAmount) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">控除合計</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
              {latestDeductionTotal != null
                ? yen(latestDeductionTotal)
                : latest.grossAmount != null
                  ? yen(latest.grossAmount - latest.amount)
                  : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">手取り額</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-navy">{yen(latest.amount)}</p>
          </div>
        </div>
      </Card>

      {aggregated.length > 0 && (
        <Card className="p-5">
          <p className="mb-4 text-sm font-semibold text-slate-700">よく引かれているもの</p>
          <div className="space-y-3">
            {aggregated.slice(0, 8).map(({ label, total, count }) => (
              <div key={label}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-600">
                    {label} <span className="text-slate-400">({count}ヶ月)</span>
                  </span>
                  <span className="font-semibold tabular-nums text-slate-800">{yen(total)}</span>
                </div>
                <ProgressBar value={aggregated[0].total > 0 ? (total / aggregated[0].total) * 100 : 0} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
