import { Link } from "react-router-dom";
import { Wallet, CalendarClock, StickyNote, Plane, Mail, Settings, ArrowRight, type LucideIcon } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

type Accent = "money" | "schedule" | "notes" | "trips" | "gmail";

interface TopCard {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: Accent;
}

const TOP_CARDS: TopCard[] = [
  {
    to: "/records/expense",
    label: "お金管理",
    description: "収支・固定費・給与",
    icon: Wallet,
    accent: "money",
  },
  {
    to: "/schedule",
    label: "予定・タスク管理",
    description: "予定とタスクを確認",
    icon: CalendarClock,
    accent: "schedule",
  },
  {
    to: "/records/notes",
    label: "メモ・リスト",
    description: "メモや各種リスト",
    icon: StickyNote,
    accent: "notes",
  },
  {
    to: "/trips",
    label: "旅行計画",
    description: "旅の準備をまとめて",
    icon: Plane,
    accent: "trips",
  },
  {
    to: "/gmail",
    label: "Gmail自動返信",
    description: "受信箱の確認とAI返信",
    icon: Mail,
    accent: "gmail",
  },
];

// カード識別用の固定カラー。機能を見分けるためだけの補助色であり、
// ボタンなど主要な操作色(--color-accent)には流用しない。
const ACCENT_STYLES: Record<Accent, { stripe: string; iconBg: string; glow: string; arrow: string; ring: string }> = {
  money: {
    stripe: "bg-blue-500",
    iconBg: "bg-gradient-to-br from-blue-500 to-blue-600",
    glow: "bg-blue-400",
    arrow: "text-blue-500",
    ring: "focus-visible:ring-blue-400",
  },
  schedule: {
    stripe: "bg-violet-500",
    iconBg: "bg-gradient-to-br from-violet-500 to-violet-600",
    glow: "bg-violet-400",
    arrow: "text-violet-500",
    ring: "focus-visible:ring-violet-400",
  },
  notes: {
    stripe: "bg-teal-500",
    iconBg: "bg-gradient-to-br from-teal-500 to-teal-600",
    glow: "bg-teal-400",
    arrow: "text-teal-500",
    ring: "focus-visible:ring-teal-400",
  },
  trips: {
    stripe: "bg-orange-500",
    iconBg: "bg-gradient-to-br from-orange-500 to-orange-600",
    glow: "bg-orange-400",
    arrow: "text-orange-500",
    ring: "focus-visible:ring-orange-400",
  },
  gmail: {
    stripe: "bg-pink-500",
    iconBg: "bg-gradient-to-br from-pink-500 to-pink-600",
    glow: "bg-pink-400",
    arrow: "text-pink-500",
    ring: "focus-visible:ring-pink-400",
  },
};

// 端末のローカル時刻(Date#getHours)を基準に判定する。
// 5:00-10:59 おはよう / 11:00-17:59 こんにちは / 18:00-4:59 おつかれさま。
function getGreeting(hour: number): string {
  if (hour >= 5 && hour < 11) return "おはようございます";
  if (hour >= 11 && hour < 18) return "こんにちは";
  return "おつかれさまです";
}

export default function TopPage() {
  const now = new Date();
  const dateLabel = format(now, "yyyy年M月d日(E)", { locale: ja });
  const greeting = getGreeting(now.getHours());

  return (
    <div className="min-h-screen pb-10">
      <div className="relative overflow-hidden bg-gradient-to-br from-navy via-navy to-accent px-5 pb-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
        </div>

        {/* タイトル+日付・挨拶を2行に収め、文言が変わってもヘッダー高さが伸びないようにtruncateする */}
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-white">LIFE HUB</h1>
            <p className="mt-1.5 truncate text-xs font-medium text-white/70">
              {dateLabel}
              <span className="mx-1.5 text-white/40" aria-hidden="true">
                ・
              </span>
              {greeting}
            </p>
          </div>
          <Link
            to="/settings"
            aria-label="設定"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors active:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Settings size={20} />
          </Link>
        </div>
      </div>

      {/* sm以上ではカード幅を広げず4列にして、PC幅でもカードが不必要に肥大化しないようにする */}
      <div className="grid grid-cols-2 gap-3 px-5 pt-5 sm:grid-cols-4">
        {TOP_CARDS.map(({ to, label, description, icon: Icon, accent }) => {
          const style = ACCENT_STYLES[accent];
          return (
            <Link
              key={to}
              to={to}
              className={`group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 ${style.ring}`}
            >
              <div className={`absolute inset-x-0 top-0 h-1 ${style.stripe}`} aria-hidden="true" />
              <div
                className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.07] ${style.glow}`}
                aria-hidden="true"
              />

              <div className={`flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-sm ${style.iconBg}`}>
                <Icon size={22} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold leading-snug text-navy">{label}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{description}</p>
              </div>
              <div className="h-3" aria-hidden="true" />
              <ArrowRight
                size={14}
                className={`absolute bottom-3.5 right-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none ${style.arrow}`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
