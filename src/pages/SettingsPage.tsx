import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight } from "lucide-react";
import { db, ensureDefaultSettings } from "../db/schema";
import { requestNotificationPermission, isNotificationSupported } from "../lib/notifications";
import { exportBackup, importBackup } from "../lib/backup";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";

const ACCENT_PRESETS = [
  { label: "インディゴ", value: "#4f46e5" },
  { label: "ブルー", value: "#2563eb" },
  { label: "グリーン", value: "#059669" },
  { label: "ピンク", value: "#db2777" },
  { label: "オレンジ", value: "#ea580c" },
  { label: "スレート", value: "#475569" },
];

export default function SettingsPage() {
  useEffect(() => {
    ensureDefaultSettings();
  }, []);

  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const initialized = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [monthlyIncome, setMonthlyIncome] = useState("0");
  const [savingsGoal, setSavingsGoal] = useState("0");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [accentColor, setAccentColor] = useState("#4f46e5");
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true;
      setMonthlyIncome(settings.monthlyIncome.toString());
      setSavingsGoal(settings.savingsGoalMonthly.toString());
      setNotificationsEnabled(settings.notificationsEnabled);
      setAccentColor(settings.accentColor);
    }
  }, [settings]);

  useEffect(() => {
    if (isNotificationSupported()) setPermissionStatus(Notification.permission);
  }, []);

  async function handleSaveBudget() {
    if (!settings?.id) return;
    await db.settings.update(settings.id, {
      monthlyIncome: Number(monthlyIncome) || 0,
      savingsGoalMonthly: Number(savingsGoal) || 0,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function handleToggleNotifications(next: boolean) {
    setNotificationsEnabled(next);
    if (!settings?.id) return;
    if (next) {
      const permission = await requestNotificationPermission();
      setPermissionStatus(permission);
      const granted = permission === "granted";
      await db.settings.update(settings.id, { notificationsEnabled: granted });
      if (!granted) setNotificationsEnabled(false);
    } else {
      await db.settings.update(settings.id, { notificationsEnabled: false });
    }
  }

  async function handleAccentChange(color: string) {
    setAccentColor(color);
    document.documentElement.style.setProperty("--color-accent", color);
    if (settings?.id) await db.settings.update(settings.id, { accentColor: color });
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("現在のデータをすべて置き換えて復元します。よろしいですか?")) {
      e.target.value = "";
      return;
    }
    await importBackup(file);
    e.target.value = "";
    alert("データを復元しました");
  }

  return (
    <div className="pb-10">
      <PageHeader title="設定" backTo="/" />

      <div className="space-y-4 px-5">
        <Card>
          <p className="mb-3 text-sm font-medium text-slate-600">予算設定</p>
          <div className="space-y-3">
            <Input
              label="毎月の収入(目安)"
              type="number"
              inputMode="numeric"
              value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(e.target.value)}
            />
            <Input
              label="毎月の貯金目標額"
              type="number"
              inputMode="numeric"
              value={savingsGoal}
              onChange={(e) => setSavingsGoal(e.target.value)}
            />
            <Button className="w-full" onClick={handleSaveBudget}>
              {saved ? "保存しました" : "保存する"}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-600">通知</p>
              <p className="mt-0.5 text-xs text-slate-400">アプリを開いている間のみ通知が届きます</p>
            </div>
            <button
              onClick={() => handleToggleNotifications(!notificationsEnabled)}
              aria-label="通知を切り替え"
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                notificationsEnabled ? "bg-accent" : "bg-slate-200"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  notificationsEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {permissionStatus === "denied" && (
            <p className="mt-2 text-xs text-danger">
              ブラウザの通知がブロックされています。ブラウザの設定から許可してください。
            </p>
          )}
        </Card>

        <Card>
          <p className="mb-3 text-sm font-medium text-slate-600">アクセントカラー</p>
          <div className="flex flex-wrap gap-3">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handleAccentChange(preset.value)}
                aria-label={preset.label}
                className={`h-9 w-9 rounded-full border-2 ${
                  accentColor === preset.value ? "border-slate-900" : "border-transparent"
                }`}
                style={{ backgroundColor: preset.value }}
              />
            ))}
          </div>
        </Card>

        <Card>
          <p className="mb-1 text-sm font-medium text-slate-600">データ管理</p>
          <p className="mb-3 text-xs text-slate-400">
            すべてのデータは端末内にのみ保存されています。バックアップを取っておくと安心です。
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={exportBackup}>
              書き出す
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => fileInputRef.current?.click()}>
              復元する
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </Card>

        <Link to="/records">
          <Card className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium text-slate-900">以前のデータ</p>
              <p className="mt-0.5 text-xs text-slate-400">日記・目標・習慣(新しいメニューには表示されません)</p>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </Card>
        </Link>
      </div>
    </div>
  );
}
