import { format } from "date-fns";
import { RefreshCw, Sparkles } from "lucide-react";
import {
  LONG_DAYS,
  RECENT_DAYS,
  TOP_LIMIT,
  formatShare,
  type UnusedFeature,
  type UsageReport,
  type UsageSnapshot,
} from "../../lib/featureUsage";
import { Card } from "../ui/Card";
import { ListSkeleton } from "../ui/ListSkeleton";
import { ProgressBar } from "../ui/ProgressBar";

const KIND_LABEL: Record<UnusedFeature["kind"], string> = {
  stopped: "最近ゼロ",
  dropped: "急に減った",
  idle: "しばらく未使用",
  never: "未使用",
};

const KIND_TONE: Record<UnusedFeature["kind"], string> = {
  stopped: "text-danger",
  dropped: "text-warning",
  idle: "text-slate-500",
  never: "text-slate-500",
};

interface Props {
  report: UsageReport | null;
  snapshot: UsageSnapshot | null;
  failed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

function TopFeatures({ report }: { report: UsageReport }) {
  if (report.top.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">直近{RECENT_DAYS}日に使った機能はまだありません</p>;
  }
  return (
    <ol className="space-y-3">
      {report.top.map((usage, index) => (
        <li key={usage.feature.id}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-slate-600">
              <span className="mr-2 font-semibold tabular-nums text-slate-400">{index + 1}</span>
              {usage.feature.label}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-800">
              {formatShare(usage.share30)}
              <span className="ml-1.5 font-normal text-slate-400">90日 {formatShare(usage.share90)}</span>
            </span>
          </div>
          <ProgressBar value={usage.share30} />
        </li>
      ))}
    </ol>
  );
}

function UnusedFeatures({ report }: { report: UsageReport }) {
  // 一度も使っていない機能は数が多くなりやすいので、行を並べずに名前だけまとめる
  // (使っていたのに離れた機能の方を目立たせたい)。
  const rows = report.unused.filter((item) => item.kind !== "never");
  const never = report.unused.filter((item) => item.kind === "never");

  if (rows.length === 0 && never.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">使われていない機能はありません</p>;
  }
  return (
    <div>
      {rows.length > 0 && (
        <ul className="divide-y divide-white/35">
          {rows.map((item) => (
            <li key={item.usage.feature.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                <p className="text-sm text-slate-700">{item.usage.feature.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{item.note}</p>
              </div>
              <span
                className={`shrink-0 rounded-full border border-white/50 bg-white/40 px-2.5 py-0.5 text-[11px] font-semibold ${KIND_TONE[item.kind]}`}
              >
                {KIND_LABEL[item.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {never.length > 0 && (
        <div className={rows.length > 0 ? "mt-3 border-t border-white/35 pt-3" : ""}>
          <p className="text-[11px] font-semibold text-slate-500">まだ使っていない機能</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {never.map((item) => item.usage.feature.label).join("・")}
          </p>
        </div>
      )}
    </div>
  );
}

function AllFeatures({ report }: { report: UsageReport }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">
        すべての機能の利用率({report.features.length}件)
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[300px] text-xs">
          <thead>
            <tr className="text-left text-[11px] text-slate-500">
              <th className="py-1.5 pr-3 font-medium">機能</th>
              <th className="py-1.5 pr-3 text-right font-medium">直近{RECENT_DAYS}日</th>
              <th className="py-1.5 text-right font-medium">直近{LONG_DAYS}日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/35">
            {report.features.map((usage) => (
              <tr key={usage.feature.id}>
                <td className="py-2 pr-3 text-slate-700">{usage.feature.label}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-800">
                  {formatShare(usage.share30)}
                  <span className="ml-1 text-slate-400">({usage.last30}回)</span>
                </td>
                <td className="py-2 text-right tabular-nums text-slate-800">
                  {formatShare(usage.share90)}
                  <span className="ml-1 text-slate-400">({usage.last90}回)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** ふりかえり画面の「機能の使い方」。上の週・月の切り替えとは別に、いつも直近30日・90日で見る。 */
export function UsageOverview({ report, snapshot, failed, refreshing, onRefresh }: Props) {
  const sourceNote =
    snapshot?.source === "local"
      ? "この端末に残っている記録から数えています。ログインすると、PCとスマホをまとめて数えます。"
      : "PCとスマホで同期している記録から数えています。見るだけの操作と、AIで下書きを作った回数は入りません。";

  return (
    <section className="review-usage mt-3 grid grid-cols-1 gap-3 lg:mt-4 lg:grid-cols-12" aria-label="機能の使い方">
      <Card className="p-5 lg:col-span-12 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-700">機能の使い方</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              直近{RECENT_DAYS}日と{LONG_DAYS}日に使った回数から、毎日自動で出しています
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/50 bg-white/40 px-3 text-xs font-medium text-slate-600 transition-colors active:bg-white/70 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
            {refreshing ? "数えています" : "数え直す"}
          </button>
        </div>

        {report ? (
          report.comments.length > 0 && (
            <div className="mt-4 space-y-1.5 rounded-xl bg-white/40 p-3">
              {report.comments.map((comment) => (
                <p key={comment} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                  <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
                  <span>{comment}</span>
                </p>
              ))}
            </div>
          )
        ) : failed ? (
          <p className="mt-4 text-sm text-slate-500">集計できませんでした。時間をおいて「数え直す」を押してください。</p>
        ) : (
          <div className="mt-4">
            <ListSkeleton rows={2} />
          </div>
        )}
      </Card>

      {report && (
        <>
          <Card className="p-5 lg:col-span-6 lg:p-6">
            <p className="mb-4 text-sm font-semibold text-slate-700">よく使う機能 TOP{TOP_LIMIT}</p>
            <TopFeatures report={report} />
          </Card>

          <Card className="p-5 lg:col-span-6 lg:p-6">
            <p className="mb-4 text-sm font-semibold text-slate-700">使われていない機能</p>
            <UnusedFeatures report={report} />
          </Card>

          <Card className="p-5 lg:col-span-12 lg:p-6">
            <AllFeatures report={report} />
            <div className="mt-4 space-y-1 border-t border-white/35 pt-3 text-[11px] text-slate-400">
              <p>{sourceNote}</p>
              {report.unavailable.length > 0 && (
                <p>数えられなかった機能: {report.unavailable.map((feature) => feature.label).join("・")}</p>
              )}
              {snapshot && <p>{format(snapshot.generatedAt, "M月d日 H:mm")}時点</p>}
            </div>
          </Card>
        </>
      )}
    </section>
  );
}
