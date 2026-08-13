import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { CheckSquare, Wallet, Mail, Plane, ChevronRight, Check, MapPin } from "lucide-react";
import { db } from "../db/schema";
import { todayStr, formatDisplayDate, formatGmailTimestamp } from "../lib/date";
import { parseSender, avatarColor, avatarInitial } from "../lib/gmail";
import { NOTE_TYPE_DEFS, getNoteType } from "../lib/noteTypes";
import { getScheduleCategory } from "../lib/scheduleCategories";
import { usePayPeriodBudget } from "../hooks/usePayPeriodBudget";
import { toggleTaskCompletion } from "../components/tasks/TaskList";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Badge } from "../components/ui/Badge";

const EVENT_PREVIEW_LIMIT = 3;
const TASK_PREVIEW_LIMIT = 4;
const GMAIL_PREVIEW_LIMIT = 3;

const TRIP_STATUS_LABEL: Record<string, string> = { ongoing: "旅行中", planning: "計画中", completed: "完了済み" };

export default function TopPage() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const today = todayStr();

  const eventsResult = useLiveQuery(() => db.calendarEvents.where("date").equals(today).toArray(), [today]);
  const todayEvents = [...(eventsResult ?? [])]
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))
    .slice(0, EVENT_PREVIEW_LIMIT);

  const tasksResult = useLiveQuery(
    () => db.tasks.where("dueDate").equals(today).toArray(),
    [today],
  );
  const todayTasks = (tasksResult ?? []).filter((t) => !t.parentTaskId);
  const doneCount = todayTasks.filter((t) => t.completed).length;
  const previewTasks = [...todayTasks].sort((a, b) => a.createdAt - b.createdAt).slice(0, TASK_PREVIEW_LIMIT);

  const { data: budget } = usePayPeriodBudget();

  const gmailPreview = useLiveQuery(async () => {
    const accounts = await db.gmailAccounts.toArray();
    if (accounts.length === 0) return { connected: false, emails: [] };
    const [blocked, allEmails] = await Promise.all([
      db.blockedSenders.toArray(),
      db.syncedEmails.orderBy("receivedAt").reverse().toArray(),
    ]);
    const blockedSet = new Set(blocked.map((b) => `${b.accountId}:${b.email}`));
    const emails = allEmails
      .filter((e) => !blockedSet.has(`${e.accountId}:${parseSender(e.from).email.toLowerCase()}`))
      .slice(0, GMAIL_PREVIEW_LIMIT);
    return { connected: true, emails };
  }, []);

  const notesResult = useLiveQuery(() => db.notes.toArray(), []);
  const noteSummaries = NOTE_TYPE_DEFS.map((def) => {
    const items = (notesResult ?? []).filter((n) => getNoteType(n) === def.value);
    const latest = [...items].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0];
    return { def, count: items.length, latestTitle: latest?.title };
  });

  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const featuredTrip =
    tripsResult?.find((t) => t.status === "ongoing") ??
    [...(tripsResult ?? [])].filter((t) => t.status === "planning").sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  return (
    <div className="space-y-5 px-5 pb-6 pt-5">
      {/* 時刻・日付 — 挨拶文は表示しない */}
      <div className="relative overflow-hidden rounded-2xl">
        <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-accent/10 blur-2xl" aria-hidden="true" />
        <p className="text-4xl font-bold tabular-nums tracking-tight text-navy">{format(now, "H:mm")}</p>
        <p className="mt-1 text-sm font-medium text-slate-500">{format(now, "yyyy年M月d日(E)", { locale: ja })}</p>
        <div className="mt-3 h-1 w-16 rounded-full bg-accent/40" aria-hidden="true" />
      </div>

      {/* 今日カード：予定 + タスク */}
      <Card className="overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-2">
          <div className="p-5 lg:border-r lg:border-white/40">
            <p className="mb-3 text-sm font-semibold text-slate-600">今日の予定</p>
            {todayEvents.length === 0 ? (
              <EmptyState title="今日の予定はありません" />
            ) : (
              <div className="space-y-3">
                {todayEvents.map((event) => {
                  const category = getScheduleCategory(event.category);
                  return (
                    <Link
                      key={event.id}
                      to="/schedule?view=calendar"
                      className="flex items-center gap-3 rounded-xl transition-colors hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      <span className="w-11 shrink-0 text-xs tabular-nums text-slate-500">{event.startTime ?? "終日"}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{event.title}</span>
                      <Badge tone={category.tone}>{category.label}</Badge>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link to="/schedule?view=calendar" className="mt-4 inline-block text-xs font-medium text-accent">
              予定を見る →
            </Link>
          </div>

          <div className="border-t border-white/40 p-5 lg:border-t-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-600">今日のタスク</p>
              {todayTasks.length > 0 && (
                <span className="text-xs font-medium text-slate-400">
                  {doneCount} / {todayTasks.length} 完了
                </span>
              )}
            </div>
            {todayTasks.length > 0 && (
              <div className="mb-3">
                <ProgressBar value={(doneCount / todayTasks.length) * 100} />
              </div>
            )}
            {previewTasks.length === 0 ? (
              <EmptyState icon={CheckSquare} title="今日期限のタスクはありません" />
            ) : (
              <div className="space-y-2">
                {previewTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleTaskCompletion(task)}
                      aria-label="完了切り替え"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        task.completed ? "border-success bg-success text-white" : "border-slate-300"
                      }`}
                    >
                      {task.completed && <Check size={12} strokeWidth={3} />}
                    </button>
                    <Link
                      to="/schedule?view=list"
                      className={`min-w-0 flex-1 truncate rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                        task.completed ? "text-slate-400 line-through" : "text-slate-900"
                      }`}
                    >
                      {task.title}
                    </Link>
                  </div>
                ))}
              </div>
            )}
            <Link to="/schedule?view=list" className="mt-4 inline-block text-xs font-medium text-accent">
              タスクを見る →
            </Link>
          </div>
        </div>
      </Card>

      {/* 家計：今月の残高のみ */}
      <Link to="/records/expense" className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <Card interactive className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500">今月の残高</p>
            {budget ? (
              <p className={`mt-1 text-2xl font-bold tabular-nums ${budget.remaining < 0 ? "text-danger" : "text-navy"}`}>
                ¥{budget.remaining.toLocaleString()}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-400">給与が未設定です</p>
            )}
            <span className="mt-1 inline-block text-xs font-medium text-accent">お金管理を開く →</span>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500">
            <Wallet size={22} />
          </div>
        </Card>
      </Link>

      {/* Gmail自動返信：ステータスに関係なく直近3件 */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-pink-500" />
            <p className="text-sm font-semibold text-slate-600">Gmail自動返信</p>
          </div>
          {gmailPreview?.connected && <Badge tone="success">同期済み</Badge>}
        </div>
        {!gmailPreview || gmailPreview.emails.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              icon={Mail}
              title={gmailPreview?.connected ? "メールがありません" : "Gmail未連携"}
              description={gmailPreview?.connected ? undefined : "設定画面からGmailアカウントを連携してください"}
            />
          </div>
        ) : (
          <div className="mt-3 divide-y divide-white/40 border-t border-white/40">
            {gmailPreview.emails.map((email) => {
              const sender = parseSender(email.from);
              return (
                <a
                  key={email.id}
                  href={`/gmail/mail/${email.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/40"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(sender.email)}`}
                  >
                    {avatarInitial(sender.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{sender.name}</p>
                    <p className="truncate text-xs text-slate-500">{email.subject}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{formatGmailTimestamp(email.receivedAt)}</span>
                </a>
              );
            })}
          </div>
        )}
        <Link to="/gmail" className="block px-5 py-3 text-xs font-medium text-accent">
          メールを確認 →
        </Link>
      </Card>

      {/* メモ・リスト：種類ごとに件数＋直近1件 */}
      <Link to="/records/notes" className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        <Card interactive>
          <p className="mb-3 text-sm font-semibold text-slate-600">メモ・リスト</p>
          <div className="space-y-2.5">
            {noteSummaries.map(({ def, count, latestTitle }) => {
              const Icon = def.icon;
              return (
                <div key={def.value} className="flex items-center gap-3">
                  <Icon size={16} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{latestTitle ?? def.label}</span>
                  <Badge tone={def.tone}>{count}件</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </Link>

      {/* 旅行計画：直近/進行中の1件。写真フィールドが無いためグラデーションで代替 */}
      <Link to="/trips" className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
        {featuredTrip ? (
          <div className="glass-border glass-shadow relative overflow-hidden rounded-2xl">
            <div className="h-28 bg-gradient-to-br from-slate-700 via-slate-800 to-navy" />
            <div className="glass-smoked absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-white">{featuredTrip.name}</p>
                  <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium text-white">
                    {TRIP_STATUS_LABEL[featuredTrip.status]}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1 truncate text-xs text-white/80">
                  <MapPin size={11} />
                  {formatDisplayDate(featuredTrip.startDate)} 〜 {formatDisplayDate(featuredTrip.endDate)}
                </p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-white/80" />
            </div>
          </div>
        ) : (
          <Card interactive className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                <Plane size={20} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">旅行の予定はありません</p>
                <span className="text-xs font-medium text-accent">旅行を見る →</span>
              </div>
            </div>
            <ChevronRight size={18} className="shrink-0 text-slate-300" />
          </Card>
        )}
      </Link>
    </div>
  );
}
