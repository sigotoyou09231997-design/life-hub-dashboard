import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, LineChart, Mail, Pencil, Plane, Plus, RotateCcw, Settings as SettingsIcon, StickyNote, Trash2, Wallet, type LucideIcon } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import {
  DEFAULT_QUICK_ACTION_KEYS,
  QUICK_ACTION_LIMIT,
  QUICK_ACTIONS,
  getQuickAction,
  type QuickActionKey,
} from "./quickActions";

interface Props {
  open: boolean;
  onClose: () => void;
  selectedKeys: QuickActionKey[];
  onSave: (keys: QuickActionKey[]) => void;
}

interface FeatureLink {
  to: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
}

const FEATURES: FeatureLink[] = [
  { to: "/schedule", label: "予定・タスク", icon: CalendarDays, color: "text-blue-500", bg: "bg-blue-50" },
  { to: "/records/expense", label: "お金管理", icon: Wallet, color: "text-orange-500", bg: "bg-orange-50" },
  { to: "/records/notes", label: "メモ・リスト", icon: StickyNote, color: "text-violet-500", bg: "bg-violet-50" },
  { to: "/trips", label: "旅行計画", icon: Plane, color: "text-teal-500", bg: "bg-teal-50" },
  { to: "/gmail", label: "Gmail自動返信", icon: Mail, color: "text-pink-500", bg: "bg-pink-50" },
  { to: "/review", label: "ふりかえり", icon: LineChart, color: "text-emerald-500", bg: "bg-emerald-50" },
  { to: "/settings", label: "設定", icon: SettingsIcon, color: "text-slate-500", bg: "bg-slate-100" },
];

/** Feature launcher and editor for the mobile persistent action bar. */
export function AllFeaturesSheet({ open, onClose, selectedKeys, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<QuickActionKey[]>(selectedKeys);

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setDraft(selectedKeys);
  }, [open, selectedKeys]);

  function move(key: QuickActionKey, offset: -1 | 1) {
    setDraft((current) => {
      const index = current.indexOf(key);
      const destination = index + offset;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function remove(key: QuickActionKey) {
    setDraft((current) => current.length > 1 ? current.filter((entry) => entry !== key) : current);
  }

  function add(key: QuickActionKey) {
    setDraft((current) => current.length < QUICK_ACTION_LIMIT && !current.includes(key) ? [...current, key] : current);
  }

  const available = QUICK_ACTIONS.filter(({ key }) => !draft.includes(key));

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "追従ボタンを編集" : "すべての機能"}>
      {editing ? (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-slate-700">表示中のボタン</p>
            <p className="mt-1 text-xs text-slate-500">1〜5個を表示できます。矢印で並び順を変更できます。</p>
          </div>

          <div className="space-y-2">
            {draft.map((key, index) => {
              const { label, icon: Icon, color } = getQuickAction(key);
              return (
                <div key={key} className="glass-row flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
                  <Icon size={19} className={color} />
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{label}</span>
                  <button type="button" onClick={() => move(key, -1)} disabled={index === 0} aria-label={`${label}を左へ`} className="rounded-lg p-2 text-slate-500 disabled:opacity-25"><ChevronLeft size={17} /></button>
                  <button type="button" onClick={() => move(key, 1)} disabled={index === draft.length - 1} aria-label={`${label}を右へ`} className="rounded-lg p-2 text-slate-500 disabled:opacity-25"><ChevronRight size={17} /></button>
                  <button type="button" onClick={() => remove(key)} disabled={draft.length === 1} aria-label={`${label}を外す`} className="rounded-lg p-2 text-slate-400 disabled:opacity-25"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>

          {available.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium text-slate-700">追加できるボタン</p><span className="text-xs text-slate-400">{draft.length}/{QUICK_ACTION_LIMIT}</span></div>
              <div className="grid grid-cols-2 gap-2">
                {available.map(({ key, label, icon: Icon, color }) => (
                  <button key={key} type="button" onClick={() => add(key)} disabled={draft.length >= QUICK_ACTION_LIMIT} aria-label={`${label}を追加`} className="glass-row flex min-h-12 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-700 disabled:opacity-40">
                    <Icon size={17} className={color} /><span>{label}</span><Plus size={14} className="ml-auto" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="button" onClick={() => setDraft([...DEFAULT_QUICK_ACTION_KEYS])} className="flex items-center gap-2 text-xs font-medium text-slate-500"><RotateCcw size={14} />初期状態に戻す</button>
          <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-white/50 bg-white/80 px-5 py-3 backdrop-blur-md">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setEditing(false)}>戻る</Button>
            <Button type="button" className="flex-1" onClick={() => { onSave(draft); onClose(); }}>保存する</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">機能を開く</p>
            <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/60 bg-white/35 px-3 text-xs font-semibold text-accent"><Pencil size={14} />追従ボタンを編集</button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {FEATURES.map(({ to, label, icon: Icon, color, bg }) => (
              <Link key={to} to={to} onClick={onClose} className="glass-row flex flex-col items-center gap-2 rounded-2xl py-5 text-center transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg} ${color}`}><Icon size={20} /></div>
                <span className="text-xs font-medium text-slate-700">{label}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
