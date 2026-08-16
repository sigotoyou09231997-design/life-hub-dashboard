import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { CalendarDays, Check, CheckSquare, ChevronRight, Mail, MapPin, NotebookPen, Plane, Wallet } from "lucide-react";
import { db } from "../db/schema";
import { formatDisplayDate, formatGmailTimestamp, todayStr } from "../lib/date";
import { avatarColor, avatarInitial, parseSender } from "../lib/gmail";
import { NOTE_TYPE_DEFS, getNoteType } from "../lib/noteTypes";
import { getScheduleCategory } from "../lib/scheduleCategories";
import { usePayPeriodBudget } from "../hooks/usePayPeriodBudget";
import { toggleTaskCompletion } from "../components/tasks/TaskList";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ProgressBar } from "../components/ui/ProgressBar";

const EVENT_PREVIEW_LIMIT = 3;
const TASK_PREVIEW_LIMIT = 4;
const GMAIL_PREVIEW_LIMIT = 3;
const TRIP_STATUS_LABEL: Record<string, string> = { ongoing: "旅行中", planning: "計画中", completed: "完了済み" };

function SectionTitle({ icon: Icon, children, count }: { icon: typeof CalendarDays; children: React.ReactNode; count?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-slate-600">
        <Icon size={15} strokeWidth={1.7} />
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">{children}</h2>
      </div>
      {count && <span className="text-[11px] font-medium text-slate-500">{count}</span>}
    </div>
  );
}

export default function TopPage() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const today = todayStr();
  const eventsResult = useLiveQuery(() => db.calendarEvents.where("date").equals(today).toArray(), [today]);
  const todayEvents = [...(eventsResult ?? [])]
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))
    .slice(0, EVENT_PREVIEW_LIMIT);

  const tasksResult = useLiveQuery(() => db.tasks.where("dueDate").equals(today).toArray(), [today]);
  const todayTasks = (tasksResult ?? []).filter((task) => !task.parentTaskId);
  const doneCount = todayTasks.filter((task) => task.completed).length;
  const previewTasks = [...todayTasks].sort((a, b) => a.createdAt - b.createdAt).slice(0, TASK_PREVIEW_LIMIT);
  const { data: budget } = usePayPeriodBudget();

  const gmailPreview = useLiveQuery(async () => {
    const accounts = await db.gmailAccounts.toArray();
    if (accounts.length === 0) return { connected: false, emails: [] };
    const [blocked, allEmails] = await Promise.all([
      db.blockedSenders.toArray(),
      db.syncedEmails.orderBy("receivedAt").reverse().toArray(),
    ]);
    const blockedSet = new Set(blocked.map((item) => `${item.accountId}:${item.email}`));
    const emails = allEmails
      .filter((email) => !blockedSet.has(`${email.accountId}:${parseSender(email.from).email.toLowerCase()}`))
      .slice(0, GMAIL_PREVIEW_LIMIT);
    return { connected: true, emails };
  }, []);

  const notesResult = useLiveQuery(() => db.notes.toArray(), []);
  const noteSummaries = NOTE_TYPE_DEFS.map((definition) => {
    const items = (notesResult ?? []).filter((note) => getNoteType(note) === definition.value);
    const latest = [...items].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0];
    return { definition, count: items.length, latestTitle: latest?.title };
  });

  const tripsResult = useLiveQuery(() => db.trips.toArray(), []);
  const featuredTrip =
    tripsResult?.find((trip) => trip.status === "ongoing") ??
    [...(tripsResult ?? [])].filter((trip) => trip.status === "planning").sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  return (
    <div className="micro-contrast px-5 pb-6 pt-5 lg:px-8 lg:pb-8 lg:pt-7">
      <section className="mb-7 pb-5 lg:mb-9 lg:flex lg:items-end lg:justify-between lg:pb-5">
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-500">Today at a glance</p>
          <p className="text-[3.1rem] font-light leading-[.88] tabular-nums tracking-[-0.065em] text-navy [text-shadow:0_1px_18px_rgba(255,255,255,.18)] lg:text-[4.75rem]">
            {format(now, "H:mm")}
          </p>
          <p className="mt-3 text-sm font-medium tracking-[.025em] text-slate-600">
            {format(now, "yyyy年M月d日 EEEE", { locale: ja })}
          </p>
        </div>
        <div className="mt-5 max-w-md text-left lg:mt-0 lg:text-right">
          <p className="text-xs font-semibold tracking-wide text-slate-700">おはようございます</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">今日の予定、タスク、暮らしの記録をひとつの場所で。</p>
        </div>
      </section>

      <div className="home-card-grid grid grid-cols-1 gap-4 lg:grid-cols-2 lg:auto-rows-min xl:grid-cols-12">
        <Card className="glass-card--strong glass-card--reflect p-5 lg:p-6 xl:col-span-5">
          <SectionTitle icon={CalendarDays} count={`${todayEvents.length}件`}>今日の予定</SectionTitle>
          {todayEvents.length === 0 ? (
            <EmptyState title="今日の予定はありません" />
          ) : (
            <div className="divide-y divide-white/35">
              {todayEvents.map((event) => {
                const category = getScheduleCategory(event.category);
                return (
                  <Link key={event.id} to="/schedule?view=calendar" className="flex min-h-12 items-center gap-3 py-2 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50">
                    <span className="w-12 shrink-0 text-xs tabular-nums text-slate-500">{event.startTime ?? "終日"}</span>
                    <span className="h-6 w-px bg-blue-400/55" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{event.title}</span>
                    <Badge tone={category.tone}>{category.label}</Badge>
                  </Link>
                );
              })}
            </div>
          )}
          <Link to="/schedule?view=calendar" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent">すべて見る <ChevronRight size={13} /></Link>
        </Card>

        <Card className="glass-card--strong glass-card--reflect p-5 lg:p-6 xl:col-span-4">
          <SectionTitle icon={CheckSquare} count={todayTasks.length ? `${doneCount} / ${todayTasks.length}` : undefined}>今日のタスク</SectionTitle>
          {todayTasks.length > 0 && <ProgressBar value={(doneCount / todayTasks.length) * 100} />}
          {previewTasks.length === 0 ? (
            <EmptyState title="今日期限のタスクはありません" />
          ) : (
            <div className="mt-3 space-y-1.5">
              {previewTasks.map((task) => (
                <div key={task.id} className={`task-completion flex min-h-9 items-center gap-3 transition-opacity ${task.completed ? "task-completion--done opacity-55" : ""}`}>
                  <button type="button" onClick={() => toggleTaskCompletion(task)} aria-label="完了切り替え" className={`flex h-5 w-5 shrink-0 items-center justify-center border transition-all ${task.completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-400/70 bg-white/20"}`}>
                    {task.completed && <Check size={12} strokeWidth={2.5} className="animate-check-pop motion-reduce:animate-none" />}
                  </button>
                  <Link to="/schedule?view=list" className={`min-w-0 flex-1 truncate text-sm font-medium text-slate-800 ${task.completed ? "line-through" : ""}`}>{task.title}</Link>
                </div>
              ))}
            </div>
          )}
          <Link to="/schedule?view=list" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent">タスクを見る <ChevronRight size={13} /></Link>
        </Card>

        <Link to="/records/expense" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 xl:col-span-3">
          <Card interactive className="flex h-full min-h-[170px] flex-col justify-between p-5 lg:p-6">
            <SectionTitle icon={Wallet}>今月の残高</SectionTitle>
            <div>
              {budget ? (
                <p className={`text-[2.1rem] font-medium tabular-nums tracking-[-0.045em] ${budget.remaining < 0 ? "text-danger" : "text-navy"}`}>¥{budget.remaining.toLocaleString()}</p>
              ) : (
                <div><p className="text-[2rem] font-light tracking-[-0.04em] text-navy">¥ ---</p><p className="mt-1 text-xs text-slate-500">給与を登録すると自動計算します</p></div>
              )}
              <div className="mt-5 h-px w-full bg-gradient-to-r from-blue-500/55 via-violet-400/35 to-transparent" />
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent">家計簿を開く <ChevronRight size={13} /></span>
            </div>
          </Card>
        </Link>

        <Card className="home-communication-card overflow-hidden p-0 xl:col-span-6">
          <div className="flex items-center justify-between px-5 pb-3 pt-5 lg:px-6 lg:pt-6">
            <SectionTitle icon={Mail}>Gmail</SectionTitle>
            {gmailPreview?.connected && <Badge tone="success">同期済み</Badge>}
          </div>
          {!gmailPreview || gmailPreview.emails.length === 0 ? (
            <div className="px-5 pb-4"><EmptyState title={gmailPreview?.connected ? "メールがありません" : "Gmail未連携"} description={gmailPreview?.connected ? undefined : "連携すると受信メールとAI返信案を確認できます"} /></div>
          ) : (
            <div className="divide-y divide-white/35 border-t border-white/35">
              {gmailPreview.emails.map((email) => {
                const sender = parseSender(email.from);
                return (
                  <a key={email.id} href={`/gmail/mail/${email.id}`} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/15 lg:px-6">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(sender.email)}`}>{avatarInitial(sender.name)}</div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{sender.name}</p><p className="truncate text-xs text-slate-500">{email.subject}</p></div>
                    <span className="shrink-0 text-[11px] text-slate-500">{formatGmailTimestamp(email.receivedAt)}</span>
                  </a>
                );
              })}
            </div>
          )}
          <Link to="/gmail" className="block border-t border-white/35 px-5 py-3 text-xs font-semibold text-accent lg:px-6">メールを確認 →</Link>
        </Card>

        <Link to="/records/notes" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 xl:col-span-3">
          <Card interactive className="home-utility-card h-full p-5 lg:p-5">
            <SectionTitle icon={NotebookPen}>メモ・リスト</SectionTitle>
            <div className="space-y-3">
              {noteSummaries.map(({ definition, count, latestTitle }) => {
                const Icon = definition.icon;
                return <div key={definition.value} className="flex items-center gap-2.5"><Icon size={15} className="text-slate-500" /><span className="min-w-0 flex-1 truncate text-sm text-slate-700">{latestTitle ?? definition.label}</span><span className="text-xs tabular-nums text-slate-500">{count}</span></div>;
              })}
            </div>
          </Card>
        </Link>

        <Link to="/trips" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 xl:col-span-3">
          <Card interactive className="home-utility-card flex h-full min-h-[170px] flex-col justify-between p-5 lg:p-5">
            <SectionTitle icon={Plane}>旅行計画</SectionTitle>
            {featuredTrip ? (
              <div>
                <div className="mb-2 flex items-center gap-2"><p className="truncate text-lg font-semibold text-slate-800">{featuredTrip.name}</p><Badge tone="accent">{TRIP_STATUS_LABEL[featuredTrip.status]}</Badge></div>
                <p className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} />{formatDisplayDate(featuredTrip.startDate)} 〜 {formatDisplayDate(featuredTrip.endDate)}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">次の旅を計画しましょう。</p>
            )}
            <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-accent">旅行を見る <ChevronRight size={13} /></span>
          </Card>
        </Link>
      </div>
    </div>
  );
}
