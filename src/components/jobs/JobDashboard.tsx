import type { JobApplication } from "../../types";
import { todayStr } from "../../lib/date";
import { summarizeJobApplications } from "../../lib/jobStats";
import { Card } from "../ui/Card";
import { ProgressBar } from "../ui/ProgressBar";

/** 段階の色。Badge の tone と同じ意味で、棒の塗りに読み替える。 */
const BAR_COLOR: Record<"neutral" | "accent" | "success" | "danger", string> = {
  neutral: "bg-slate-400",
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
};

function rate(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

/** 応募先の集計。応募が1件も無いときは、一覧側の空状態に任せて何も描かない。 */
export function JobDashboard({ applications }: { applications: JobApplication[] }) {
  if (applications.length === 0) return null;
  const stats = summarizeJobApplications(applications, todayStr());

  return (
    <Card className="job-dashboard p-5 lg:p-6">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">選考状況</p>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {[
          ["応募総数", `${stats.total}件`, "text-slate-800"],
          ["選考中", `${stats.active}件`, "text-slate-800"],
          ["内定", `${stats.offers}件`, stats.offers > 0 ? "text-success" : "text-slate-800"],
          ["内定率", rate(stats.offerRate), "text-slate-800"],
        ].map(([label, value, tone]) => (
          <div key={label}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        内定率は、結果が出た{stats.decided}件(内定・お見送り・辞退)に対する割合です。
        面接まで進んでいるのは{stats.interviewReached}件({rate(stats.interviewRate)})。
      </p>

      {(stats.upcoming > 0 || stats.overdue > 0) && (
        <p className="mt-1.5 text-xs text-slate-500">
          次の予定が決まっているのは{stats.upcoming}件
          {stats.overdue > 0 && (
            <span className="text-danger">・日が過ぎたままなのが{stats.overdue}件</span>
          )}
        </p>
      )}

      <div className="mt-4 space-y-2.5 border-t border-white/35 pt-4">
        {/* 0件の段階も出す。どこで止まっているかは、空いている段階を見ても分かるため。 */}
        {stats.byStage.map(({ stage, count, ratio }) => (
          <div key={stage.value}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="text-slate-600">{stage.label}</span>
              <span className="tabular-nums text-slate-500">
                <span className="font-semibold text-slate-800">{count}</span>件
              </span>
            </div>
            <ProgressBar value={ratio} colorClass={BAR_COLOR[stage.tone]} />
          </div>
        ))}
      </div>
    </Card>
  );
}
