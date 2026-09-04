import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import {
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  NotebookPen,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { db } from "../db/schema";
import { todayStr } from "../lib/date";
import {
  compareToPrevious,
  monthlyExpenseTrend,
  moodTrend,
  resolveReviewPeriod,
  summarizeReview,
  MOOD_TREND_MONTHS,
  TREND_MONTHS,
  type MonthlyAmount,
  type MoodPoint,
  type ReviewInput,
  type ReviewSpan,
  type ReviewSummary,
} from "../lib/review";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { ProgressBar } from "../components/ui/ProgressBar";
import { EmptyState } from "../components/ui/EmptyState";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useDelayedFlag } from "../hooks/useDelayedFlag";

const CATEGORY_LIMIT = 6;

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

function MetricCard({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string; note?: string }) {
  return (
    <Card className="review-metric p-4 lg:col-span-3 lg:p-5">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon size={14} />
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-slate-800">{value}</p>
      {note && <p className="mt-1 text-[11px] text-slate-400">{note}</p>}
    </Card>
  );
}

/** 日別の支出を細い棒で並べる。目盛りは付けない — 金額そのものは上の数字で
 * 読めるので、ここは「どの日に寄っていたか」だけが分かればいい。 */
function DailyBars({ summary }: { summary: ReviewSummary }) {
  const max = Math.max(...summary.dailyExpenses.map((day) => day.amount), 1);
  // 月の31本は日ごとのラベルを入れると潰れるので、週だけ曜日を出す。
  const showLabels = summary.period.span === "week";
  return (
    <div className="review-bars flex items-end gap-1" style={{ height: 96 }}>
      {summary.dailyExpenses.map((day) => (
        <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
          {/* 色に bg-accent/70 のような不透明度は付けない。--color-accent はCSS変数なので、
              Tailwindが不透明度を混ぜられず background-color が透明になり、棒が消える。 */}
          <div
            className={`w-full rounded-t-[3px] ${day.amount > 0 ? "bg-accent" : "bg-white/45"}`}
            style={{ height: `${day.amount > 0 ? Math.max(4, (day.amount / max) * 100) : 3}%` }}
            title={`${day.date} ${yen(day.amount)}`}
          />
          {showLabels && (
            <span className="text-[10px] text-slate-400">{format(parseISO(day.date), "E", { locale: ja })}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** YYYY-MM を「2026年3月」に。ReviewPeriod.label(見ている月)と同じ書き方に揃える。 */
function monthTitle(month: string): string {
  const [year, index] = month.split("-");
  return `${year}年${Number(index)}月`;
}

/** 棒の上に添える金額。6本並ぶので、万を超えたら「8.2万」に丸めて桁を詰める。 */
function compactYen(n: number): string {
  if (n <= 0) return "—";
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return n.toLocaleString();
}

/** 月ごとの支出を並べた棒グラフ。見ている月だけ色を付けて、残りは
 * 比べる相手として薄く置く。目盛りは付けず、棒の上の金額で読ませる。 */
function MonthlyTrendBars({ trend, currentMonth }: { trend: MonthlyAmount[]; currentMonth: string }) {
  const max = Math.max(...trend.map((month) => month.amount), 1);
  return (
    <div className="review-trend flex items-stretch gap-2" style={{ height: 148 }}>
      {trend.map((month) => {
        const isCurrent = month.month === currentMonth;
        return (
          <div key={month.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span
              className={`text-[10px] leading-none tabular-nums ${isCurrent ? "font-semibold text-slate-700" : "text-slate-400"}`}
            >
              {compactYen(month.amount)}
            </span>
            {/* 棒の高さは%で出すので、入れ物側の高さが決まっている必要がある(flex-1で決まる)。 */}
            <div className="flex w-full min-h-0 flex-1 items-end">
              <div
                // 色に bg-accent/70 のような不透明度は付けない。--color-accent はCSS変数なので、
                // Tailwindが不透明度を混ぜられず background-color が透明になり、棒が消える。
                className={`w-full rounded-t-[4px] ${
                  month.amount === 0 ? "bg-white/45" : isCurrent ? "bg-accent" : "bg-slate-400/45"
                }`}
                style={{ height: `${month.amount > 0 ? Math.max(4, (month.amount / max) * 100) : 3}%` }}
                title={`${month.month} ${yen(month.amount)}`}
              />
            </div>
            <span className={`text-[10px] leading-none ${isCurrent ? "font-semibold text-slate-600" : "text-slate-400"}`}>
              {month.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const MOOD_LANES = [
  { score: 3, label: "よい", color: "#22a06b" },
  { score: 2, label: "ふつう", color: "#9aa3af" },
  { score: 1, label: "わるい", color: "#d97757" },
];

/** 平均に近い気分の色。2.5以上は「よい」寄り、1.5以下は「わるい」寄りとして塗る。 */
function moodColor(score: number): string {
  if (score >= 2.5) return MOOD_LANES[0].color;
  if (score <= 1.5) return MOOD_LANES[2].color;
  return MOOD_LANES[1].color;
}

function moodPointTitle(point: MoodPoint): string {
  if (point.score == null) return `${point.label} 記録なし`;
  const { good, normal, bad } = point.counts;
  const parts = [good ? `よい${good}` : "", normal ? `ふつう${normal}` : "", bad ? `わるい${bad}` : ""].filter(Boolean);
  return `${point.label} 平均${point.score.toFixed(1)}(${parts.join("・")})`;
}

/**
 * 日記の気分の推移。3本の目安線の上に点を打ち、記録のある区間どうしだけを線でつなぐ。
 *
 * 棒グラフにしないのは、気分が3段階しか無いので棒だと高さの差が読めないため。
 * 記録が無い区間は点を打たず線も切る — 0の棒を置くと「その日はとても悪かった」に見える。
 */
function MoodTrendChart({ points }: { points: MoodPoint[] }) {
  const height = 120;
  const padY = 14;
  // 点は各区間の真ん中に置く。両端が枠に貼り付かないので、線の向きが読みやすい。
  const step = 100 / points.length;
  const xOf = (index: number) => step * index + step / 2;
  const yOf = (score: number) => padY + ((3 - score) / 2) * (height - padY * 2);

  // 記録の途切れで線を分ける。1点だけの区間は線にならないので点だけが残る。
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((point, index) => {
    if (point.score == null) {
      if (current.length > 1) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xOf(index), y: yOf(point.score) });
  });
  if (current.length > 1) segments.push(current);

  return (
    <div className="review-mood">
      <div className="flex gap-2">
        {/* 目盛りの文字は幅を固定する。下の日付の並びを同じ幅だけ右へずらして頭を揃えるため。 */}
        <div className="flex w-9 shrink-0 flex-col justify-between py-[10px] text-[10px] text-slate-400" style={{ height }}>
          {MOOD_LANES.map((lane) => (
            <span key={lane.score}>{lane.label}</span>
          ))}
        </div>
        <svg
          className="min-w-0 flex-1"
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          style={{ height }}
          role="img"
          aria-label="日記の気分の推移"
        >
          {MOOD_LANES.map((lane) => (
            <line
              key={lane.score}
              x1={0}
              x2={100}
              y1={yOf(lane.score)}
              y2={yOf(lane.score)}
              stroke="currentColor"
              className="text-slate-300"
              strokeWidth={0.4}
              strokeDasharray="1.5 1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {segments.map((segment, i) => (
            <polyline
              key={i}
              points={segment.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              className="text-slate-400"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {points.map((point, index) =>
            point.score == null ? null : (
              // viewBoxを横に引き伸ばしているので、円のままだと横長の楕円になる。
              // 半径を持たない点として描くため、線端を丸めた長さ0の線で打つ。
              <line
                key={point.key}
                x1={xOf(index)}
                x2={xOf(index)}
                y1={yOf(point.score)}
                y2={yOf(point.score)}
                stroke={moodColor(point.score)}
                strokeWidth={7}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              >
                <title>{moodPointTitle(point)}</title>
              </line>
            ),
          )}
        </svg>
      </div>
      <div className="mt-1 flex pl-[calc(2.25rem+0.5rem)]">
        {points.map((point) => (
          <span key={point.key} className="min-w-0 flex-1 text-center text-[10px] text-slate-400">
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const [span, setSpan] = useState<ReviewSpan>("week");
  // 期間ごとに別々に覚える — 週で3つ戻ってから月に切り替えたとき、3か月前に
  // 飛ぶより「今月」から見せた方が迷わない。
  const [offsets, setOffsets] = useState<Record<ReviewSpan, number>>({ week: 0, month: 0 });
  const offset = offsets[span];
  const setOffset = (next: number) => setOffsets((current) => ({ ...current, [span]: next }));

  // 日付が変わったら期間も計算し直したいので、todayStr()を依存に入れる。
  const today = todayStr();
  const period = resolveReviewPeriod(span, offset, parseISO(today));
  const previousPeriod = resolveReviewPeriod(span, offset - 1, parseISO(today));

  const dataResult = useLiveQuery(async (): Promise<ReviewInput> => {
    const [transactions, tasks, events, notes, diaryEntries] = await Promise.all([
      db.transactions.toArray(),
      db.tasks.toArray(),
      db.calendarEvents.toArray(),
      db.notes.toArray(),
      db.diaryEntries.toArray(),
    ]);
    return { transactions, tasks, events, notes, diaryEntries };
  }, []);

  const showSkeleton = useDelayedFlag(dataResult === undefined);

  const summary = dataResult ? summarizeReview(dataResult, period) : null;
  const previous = dataResult ? summarizeReview(dataResult, previousPeriod) : null;
  const expenseDelta = summary && previous ? compareToPrevious(summary.expenseTotal, previous.expenseTotal) : null;
  const dayCount = summary?.dailyExpenses.length ?? 0;

  // 月ごと表示のときだけ、直近数か月の支出を並べて増減の流れを見せる。
  // 週ごとは上の日別の棒で足りるので出さない。
  const trend = span === "month" && dataResult ? monthlyExpenseTrend(dataResult.transactions, period) : null;
  // 気分の推移は週・月のどちらでも出す(週はその週の1日ずつ、月は直近数か月の平均)。
  // 気分を付けた日記が1つも無い期間はカードごと出さない — 点の無い枠だけが残るため。
  const moodPoints = dataResult ? moodTrend(dataResult.diaryEntries, period) : null;
  const hasMood = Boolean(moodPoints?.some((point) => point.score != null));

  const spanWord = span === "week" ? "週" : "月";

  return (
    <div className="spatial-page review-page micro-contrast mx-auto max-w-[1040px] pb-10 lg:pb-8">
      <PageHeader title="ふりかえり" subtitle="お金・予定タスク・メモをまとめて見る" backTo="/" />

      <div className="spatial-page-tabs mx-5 mb-3 lg:mx-8 lg:mb-4 lg:max-w-[320px]">
        <Tabs
          options={[
            { value: "week", label: "週ごと" },
            { value: "month", label: "月ごと" },
          ]}
          value={span}
          onChange={setSpan}
        />
      </div>

      {/* 背景が写真なので、地の無いまま置くと日付の文字が沈んで読めない。
          タブと同じように、面(glass-row)の上に乗せる。 */}
      <div className="glass-row mx-5 mb-4 flex items-center justify-between gap-3 rounded-2xl px-2 py-2 lg:mx-8 lg:mb-5 lg:max-w-[320px]">
        <button
          type="button"
          onClick={() => setOffset(offset - 1)}
          aria-label={`前の${spanWord}へ`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors active:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <ChevronLeft size={19} />
        </button>
        <div className="min-w-0 text-center">
          <p className="truncate text-base font-semibold text-slate-800">{period.label}</p>
          <p className="text-[11px] text-slate-500">
            {offset === 0 ? `今${spanWord}` : `${-offset}${spanWord}前`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOffset(offset + 1)}
          // 今週(今月)より先は記録が存在しないので進めない。
          disabled={offset >= 0}
          aria-label={`次の${spanWord}へ`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors active:bg-white/60 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <ChevronRight size={19} />
        </button>
      </div>

      <div className="spatial-page-content px-5 lg:px-8">
        {!summary ? (
          showSkeleton ? <ListSkeleton rows={3} /> : null
        ) : summary.isEmpty ? (
          <EmptyState
            card
            icon={Sparkles}
            title={`この${spanWord}の記録はありません`}
            description="支出・タスク・日記・メモを付けると、ここにまとまります。"
          />
        ) : (
          <div key={`${span}:${offset}`} className="grid grid-cols-2 gap-3 animate-fade-in motion-reduce:animate-none lg:grid-cols-12">
            <Card className="review-spend-module col-span-2 flex flex-col p-5 lg:col-span-7 lg:p-7">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="whitespace-nowrap text-[11px] font-semibold tracking-[0.08em] text-slate-500">使った金額</p>
                  <p className="mt-3 text-4xl font-medium tabular-nums tracking-[-0.05em] text-navy lg:text-5xl">
                    {yen(summary.expenseTotal)}
                  </p>
                </div>
                {expenseDelta && expenseDelta.diff !== 0 && (
                  <span
                    className={`shrink-0 rounded-full border border-white/50 bg-white/40 px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                      expenseDelta.diff > 0 ? "text-danger" : "text-success"
                    }`}
                  >
                    前の{spanWord}より {expenseDelta.diff > 0 ? "+" : "−"}
                    {yen(Math.abs(expenseDelta.diff))}
                  </span>
                )}
              </div>
              <div className="mt-5">
                <DailyBars summary={summary} />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/35 pt-3 text-xs text-slate-500">
                <span>1日あたり {yen(summary.expensePerDay)}</span>
                <span>{summary.expenseCount} 件の支出</span>
              </div>
            </Card>

            <Card className="review-life-module col-span-2 p-5 lg:col-span-5 lg:p-7">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">この{spanWord}の記録</p>
              <div className="mt-5 divide-y divide-white/35">
                {[
                  ["完了したタスク", `${summary.tasksCompleted} 件`],
                  ["予定", `${summary.eventCount} 件`],
                  ["書いた日記", `${summary.diaryCount} 件`],
                  ["追加したメモ", `${summary.noteCount} 件`],
                  ["記録した収入", yen(summary.incomeTotal)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-3 text-sm">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-semibold tabular-nums text-slate-800">{value}</span>
                  </div>
                ))}
              </div>
            </Card>

            {trend && (
              <Card className="review-trend-module col-span-2 p-5 lg:col-span-12 lg:p-6">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-slate-700">月ごとの支出の推移</p>
                  <p className="text-[11px] text-slate-500">
                    直近{TREND_MONTHS}か月 ({monthTitle(trend[0].month)} 〜 {period.label})
                  </p>
                </div>
                <MonthlyTrendBars trend={trend} currentMonth={period.start.slice(0, 7)} />
              </Card>
            )}

            {moodPoints && hasMood && (
              <Card className="review-mood-module col-span-2 p-5 lg:col-span-12 lg:p-6">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-semibold text-slate-700">日記の気分の推移</p>
                  <p className="text-[11px] text-slate-500">
                    {span === "week" ? period.label : `直近${MOOD_TREND_MONTHS}か月の平均`}
                  </p>
                </div>
                <MoodTrendChart points={moodPoints} />
                <p className="mt-3 text-[11px] text-slate-400">気分を付けていない日記は数に入れていません。</p>
              </Card>
            )}

            <MetricCard
              icon={CheckSquare}
              label="片付いたタスク"
              value={`${summary.tasksCompleted} 件`}
              note={summary.tasksCompleted > 0 ? `1日あたり ${(summary.tasksCompleted / Math.max(1, dayCount)).toFixed(1)} 件` : "この期間の完了はありません"}
            />
            <MetricCard
              icon={CalendarDays}
              label="何か記録した日"
              value={`${summary.activeDays} / ${dayCount} 日`}
              note={`この${spanWord}は ${dayCount} 日間`}
            />
            <MetricCard
              icon={NotebookPen}
              label="日記とメモ"
              value={`${summary.diaryCount + summary.noteCount} 件`}
              note={`日記 ${summary.diaryCount} 件 / メモ ${summary.noteCount} 件`}
            />
            <MetricCard
              icon={Wallet}
              label="収支"
              value={yen(summary.incomeTotal - summary.expenseTotal)}
              note={`収入 ${yen(summary.incomeTotal)} − 支出 ${yen(summary.expenseTotal)}`}
            />

            <Card className="review-breakdown-module col-span-2 p-5 lg:col-span-12 lg:p-6">
              <p className="mb-4 text-sm font-semibold text-slate-700">何に使ったか</p>
              {summary.expenseByCategory.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">この{spanWord}の支出記録はありません</p>
              ) : (
                <div className="space-y-3">
                  {summary.expenseByCategory.slice(0, CATEGORY_LIMIT).map(({ category, amount }) => (
                    <div key={category}>
                      <div className="mb-1.5 flex justify-between text-xs">
                        <span className="text-slate-600">{category}</span>
                        <span className="font-semibold tabular-nums text-slate-800">{yen(amount)}</span>
                      </div>
                      <ProgressBar value={summary.expenseTotal > 0 ? (amount / summary.expenseTotal) * 100 : 0} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
