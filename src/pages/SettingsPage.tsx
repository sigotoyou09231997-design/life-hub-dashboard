import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/auth-js";
import { Bell, CalendarArrowUp, Database, Image as ImageIcon, Mail, PiggyBank, Wallet } from "lucide-react";
import { db, ensureDefaultSettings } from "../db/schema";
import type { CategoryBudget, GmailAccount, SavingsGoal } from "../types";
import { sortSavingsGoals } from "../lib/savingsGoal";
import { sortCategoryBudgets, totalCategoryBudget, unbudgetedCategories } from "../lib/categoryBudget";
import { buildCalendarIcs, calendarIcsFilename, downloadIcs } from "../lib/ical";
import { exportBackup, importBackup } from "../lib/backup";
import { startGmailOAuth } from "../lib/gmail";
import { probeTripCover, type TripCoverProbe } from "../lib/tripCovers";
import { auth, isSupabaseConfigured } from "../lib/supabase";
import { getSupabaseDataClient } from "../lib/supabaseData";
import {
  isPushConfigured,
  getPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
  getDisabledCategories,
  setDisabledCategories,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "../lib/pushNotifications";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { ListRow } from "../components/ui/ListRow";
import { Button } from "../components/ui/Button";
import { AmountInput, Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { SwitchField } from "../components/ui/SwitchField";
import { useToast } from "../components/ui/ToastProvider";

export default function SettingsPage() {
  const showToast = useToast();

  useEffect(() => {
    ensureDefaultSettings();
  }, []);

  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const gmailAccounts = useLiveQuery(() => db.gmailAccounts.toArray(), []);
  const calendarEvents = useLiveQuery(() => db.calendarEvents.toArray(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 貯金目標は「毎月の目標額1つ」から、名前つきで複数持てるテーブルへ移した
  // (db/schema.ts の v15)。並びは追加した順で、上の目標から順に埋まっていく。
  const savingsGoals = useLiveQuery(async () => sortSavingsGoals(await db.savingsGoals.toArray()), []);
  const [goalDraft, setGoalDraft] = useState<{ id?: string; name: string; amount: string } | null>(null);
  const goalTotal = (savingsGoals ?? []).reduce((sum, goal) => sum + goal.monthlyAmount, 0);
  const goalDraftAmount = Math.max(0, Math.round(Number(goalDraft?.amount ?? "") || 0));
  const goalDraftValid = Boolean(goalDraft && goalDraft.name.trim() && goalDraftAmount > 0);

  async function handleSaveGoal() {
    if (!goalDraft || !goalDraftValid) return;
    const name = goalDraft.name.trim();
    if (goalDraft.id) {
      await db.savingsGoals.update(goalDraft.id, { name, monthlyAmount: goalDraftAmount });
    } else {
      await db.savingsGoals.add({ name, monthlyAmount: goalDraftAmount, createdAt: Date.now() });
    }
    setGoalDraft(null);
    showToast(goalDraft.id ? "貯金目標を保存しました" : "貯金目標を追加しました");
  }

  async function handleDeleteGoal(goal: SavingsGoal) {
    if (!goal.id) return;
    if (!confirm(`「${goal.name}」を削除します。よろしいですか?`)) return;
    await db.savingsGoals.delete(goal.id);
    if (goalDraft?.id === goal.id) setGoalDraft(null);
    showToast("貯金目標を削除しました");
  }

  // カテゴリ別の予算。全体の予算(給与 - 固定費)とは別に持つ、カテゴリごとの上限。
  const categoryBudgets = useLiveQuery(async () => sortCategoryBudgets(await db.categoryBudgets.toArray()), []);
  const [budgetDraft, setBudgetDraft] = useState<{ id?: string; category: string; amount: string } | null>(null);
  const budgetTotal = totalCategoryBudget(categoryBudgets ?? []);
  const budgetDraftAmount = Math.max(0, Math.round(Number(budgetDraft?.amount ?? "") || 0));
  const budgetDraftValid = Boolean(budgetDraft && budgetDraft.category && budgetDraftAmount > 0);
  // 追加のときだけ「まだ予算の無いカテゴリ」に絞る。編集中は自分のカテゴリも選べないと、
  // 金額だけ直したいときに選択肢が空になる。
  const budgetCategoryOptions = budgetDraft?.id
    ? [budgetDraft.category, ...unbudgetedCategories(categoryBudgets ?? [])]
    : unbudgetedCategories(categoryBudgets ?? []);

  async function handleSaveBudget() {
    if (!budgetDraft || !budgetDraftValid) return;
    if (budgetDraft.id) {
      await db.categoryBudgets.update(budgetDraft.id, {
        category: budgetDraft.category,
        monthlyAmount: budgetDraftAmount,
      });
    } else {
      await db.categoryBudgets.add({
        category: budgetDraft.category,
        monthlyAmount: budgetDraftAmount,
        createdAt: Date.now(),
      });
    }
    setBudgetDraft(null);
    showToast(budgetDraft.id ? "予算を保存しました" : "予算を追加しました");
  }

  async function handleDeleteBudget(budget: CategoryBudget) {
    if (!budget.id) return;
    if (!confirm(`「${budget.category}」の予算を削除します。よろしいですか?`)) return;
    await db.categoryBudgets.delete(budget.id);
    if (budgetDraft?.id === budget.id) setBudgetDraft(null);
    showToast("予算を削除しました");
  }

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [disabledCategories, setDisabledCategoriesState] = useState<Set<NotificationCategory>>(new Set());

  useEffect(() => {
    if (!isPushConfigured) return;
    getPushSubscription().then((sub) => {
      setPushEnabled(Boolean(sub));
      if (sub) getDisabledCategories().then(setDisabledCategoriesState);
    });
  }, []);

  async function handleTogglePush(next: boolean) {
    if (!session || pushBusy) return;
    setPushBusy(true);
    try {
      if (next) {
        await subscribeToPush(gmailAccounts ?? [], session.user.id);
        setPushEnabled(true);
        showToast("バックグラウンド通知を有効にしました");
      } else {
        await unsubscribeFromPush();
        setPushEnabled(false);
        showToast("バックグラウンド通知を無効にしました");
      }
    } catch {
      showToast("通知の設定に失敗しました", "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function handleToggleCategory(category: NotificationCategory, enabled: boolean) {
    const next = new Set(disabledCategories);
    if (enabled) next.delete(category);
    else next.add(category);
    setDisabledCategoriesState(next);
    try {
      await setDisabledCategories([...next]);
    } catch {
      showToast("通知の設定に失敗しました", "error");
    }
  }

  async function handleExport() {
    try {
      await exportBackup();
      showToast("バックアップを書き出しました");
    } catch {
      showToast("書き出しに失敗しました", "error");
    }
  }

  function handleExportIcs() {
    const events = calendarEvents ?? [];
    if (events.length === 0) {
      showToast("書き出す予定がありません", "error");
      return;
    }
    try {
      downloadIcs(buildCalendarIcs(events), calendarIcsFilename());
      showToast(`${events.length}件の予定を書き出しました`);
    } catch {
      showToast("書き出しに失敗しました", "error");
    }
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("現在のデータをすべて置き換えて復元します。よろしいですか?")) {
      e.target.value = "";
      return;
    }
    try {
      await importBackup(file);
      showToast("データを復元しました");
    } catch {
      showToast("復元に失敗しました。ファイルの形式を確認してください。", "error");
    } finally {
      e.target.value = "";
    }
  }

  async function handleDisconnectGmail(account: GmailAccount) {
    // Best-effort — Google's revoke endpoint doesn't need the client secret, so it's safe to call from the browser.
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(account.refreshToken)}`,
      });
    } catch {
      // ignore — we still remove the local account below
    }
    if (session) {
      // best-effort — stops background push polling for this account; a missed delete
      // just means checkGmailAndNotify.ts keeps polling with an access token that will
      // start failing anyway once Google's revoke above takes effect.
      try {
        const supabase = await getSupabaseDataClient();
        await supabase.from("gmail_server_accounts").delete().eq("user_id", session.user.id).eq("email", account.email);
      } catch {
        // ignore
      }
    }
    if (account.id == null) return;
    const accountId = account.id;
    await db.transaction("rw", [db.gmailAccounts, db.syncedEmails, db.draftReplies], async () => {
      await db.draftReplies.where("accountId").equals(accountId).delete();
      await db.syncedEmails.where("accountId").equals(accountId).delete();
      await db.gmailAccounts.delete(accountId);
    });
    showToast("Gmail連携を解除しました");
  }

  // 旅行の表紙写真が「その土地の写真」になるかを、その場で確かめるためのもの。
  // うまくいかない時に、キー未設定なのか・Places API が未有効なのか・写真が
  // 見つからなかったのかを、画面から切り分けられるようにする。
  const trips = useLiveQuery(() => db.trips.toArray(), []);
  const [coverProbe, setCoverProbe] = useState<TripCoverProbe | null>(null);
  const [coverChecking, setCoverChecking] = useState(false);

  async function handleCheckCover() {
    const trip = trips?.[0];
    setCoverChecking(true);
    try {
      // 旅行がまだ1件も無い端末でも確かめられるよう、その時は見本の旅行名で聞く。
      setCoverProbe(await probeTripCover(trip?.name ?? "神奈川旅行", trip?.destination ?? ""));
    } finally {
      setCoverChecking(false);
    }
  }

  return (
    <div className="spatial-page settings-page micro-contrast mx-auto max-w-[1040px] pb-10 lg:pb-8">
      <PageHeader title="設定" backTo="/" />

      <div className="system-control-panel settings-account-grid grid gap-3 px-5 lg:grid-cols-2 lg:px-8 lg:pt-1">
        <Card className="system-section system-section--data">
          <div className="system-section__header">
            <div className="system-section__identity"><span><Database size={17} /></span><div><h2>データ管理</h2></div></div>
            <div className="system-status is-online"><i />{session ? "端末内 + 同期" : "端末内"}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            すべてのデータは端末内にのみ保存されています。バックアップを取っておくと安心です。
          </p>
          <div className="system-state-control">
            <div><span>保存先</span><strong>{session ? "この端末 + 同期" : "この端末"}</strong></div>
            <small>{session ? "同期可能" : "この端末のみ"}</small>
          </div>
          <div className="system-section__actions flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleExport}>
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

        <Card className="system-section system-section--calendar">
          <div className="system-section__header">
            <div className="system-section__identity"><span><CalendarArrowUp size={17} /></span><div><h2>カレンダーへ書き出す</h2></div></div>
            <div className={`system-status ${(calendarEvents ?? []).length > 0 ? "is-online" : ""}`}><i />{calendarEvents === undefined ? "確認中" : `${calendarEvents.length} 件`}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            予定をまとめて .ics ファイルにします。iPhoneの標準カレンダーやGoogleカレンダーに取り込めます。
            書き出した時点の写しなので、あとでこのアプリ側を直しても取り込んだ先には反映されません。
          </p>
          <div className="system-state-control">
            <div><span>書き出す対象</span><strong>予定 {(calendarEvents ?? []).length} 件</strong></div>
            <small>タスクは含みません</small>
          </div>
          <div className="system-section__actions">
            <Button variant="secondary" className="w-full" onClick={handleExportIcs} disabled={calendarEvents === undefined}>
              .icsで書き出す
            </Button>
          </div>
        </Card>

        <Card className="system-section system-section--tripcover">
          <div className="system-section__header">
            <div className="system-section__identity"><span><ImageIcon size={17} /></span><div><h2>旅行の表紙写真</h2></div></div>
            <div className={`system-status ${coverProbe?.ok ? "is-online" : ""}`}><i />{coverProbe ? (coverProbe.ok ? "取得できました" : "取得できません") : "未確認"}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            旅行名から地名をAIが読み取り、その土地の写真を表紙にします。写真が変わらない時は、ここで理由を確かめられます。
          </p>
          {coverProbe && (
            <div className="system-state-control">
              <div className="min-w-0">
                <span>結果</span>
                <strong className="block whitespace-normal text-xs leading-relaxed">{coverProbe.message}</strong>
              </div>
              {coverProbe.url && (
                <img src={coverProbe.url} alt="" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
              )}
            </div>
          )}
          <div className="system-section__actions">
            <Button variant="secondary" className="w-full" onClick={handleCheckCover} disabled={coverChecking}>
              {coverChecking ? "確かめています…" : "いま写真が取れるか確かめる"}
            </Button>
          </div>
        </Card>

        <Card className="system-section system-section--savings">
          <div className="system-section__header">
            <div className="system-section__identity"><span><PiggyBank size={17} /></span><div><h2>貯金目標</h2></div></div>
            <div className={`system-status ${goalTotal > 0 ? "is-online" : ""}`}><i />{goalTotal > 0 ? `${(savingsGoals ?? []).length} 件` : "未設定"}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            「旅行用」「生活防衛費用」のように名前を付けて、いくつでも持てます。毎月これだけ残したい、という金額です。
            お金管理のサマリーに、今期の残額が目標に届きそうかを目標ごとに出します(上から順に埋まっていきます)。
          </p>
          <div className="system-state-control">
            <div><span>目標の合計</span><strong>¥{goalTotal.toLocaleString()} / 月</strong></div>
            <small>{goalTotal > 0 ? "サマリーに表示中" : "未設定"}</small>
          </div>

          {(savingsGoals ?? []).length > 0 && (
            <div className="system-account-list space-y-2">
              {(savingsGoals ?? []).map((goal) => (
                <ListRow key={goal.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">{goal.name}</p>
                    <p className="text-[11px] tabular-nums text-slate-500">¥{goal.monthlyAmount.toLocaleString()} / 月</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => setGoalDraft({ id: goal.id, name: goal.name, amount: String(goal.monthlyAmount) })}
                      className="text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDeleteGoal(goal)}
                      className="text-xs font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      削除
                    </button>
                  </div>
                </ListRow>
              ))}
            </div>
          )}

          {goalDraft ? (
            <div className="mt-3 space-y-3 border-t border-white/40 pt-3">
              <Input
                label="名前"
                value={goalDraft.name}
                onChange={(e) => setGoalDraft({ ...goalDraft, name: e.target.value })}
                placeholder="旅行用"
                maxLength={30}
              />
              <AmountInput
                label="毎月の目標額"
                hint="1円以上で登録できます。"
                value={goalDraft.amount}
                onChange={(e) => setGoalDraft({ ...goalDraft, amount: e.target.value })}
                min={0}
                placeholder="0"
              />
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setGoalDraft(null)}>
                  やめる
                </Button>
                <Button className="flex-1" onClick={handleSaveGoal} disabled={!goalDraftValid}>
                  {goalDraft.id ? "保存" : "追加"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="system-section__actions">
              <Button variant="secondary" className="w-full" onClick={() => setGoalDraft({ name: "", amount: "" })}>
                {(savingsGoals ?? []).length > 0 ? "+ 目標を追加" : "貯金目標を作る"}
              </Button>
            </div>
          )}
        </Card>

        <Card className="system-section system-section--budget">
          <div className="system-section__header">
            <div className="system-section__identity"><span><Wallet size={17} /></span><div><h2>カテゴリ別の予算</h2></div></div>
            <div className={`system-status ${budgetTotal > 0 ? "is-online" : ""}`}><i />{budgetTotal > 0 ? `${(categoryBudgets ?? []).length} 件` : "未設定"}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            「食費は月3万円まで」のように、カテゴリごとの上限を決められます。
            お金管理のサマリーに、今期どのカテゴリで使いすぎているかを出します
            (集計は全体の残額と同じく、給料日から次の給料日までの1期ぶんです)。
          </p>
          <div className="system-state-control">
            <div><span>上限の合計</span><strong>¥{budgetTotal.toLocaleString()} / 月</strong></div>
            <small>{budgetTotal > 0 ? "サマリーに表示中" : "未設定"}</small>
          </div>

          {(categoryBudgets ?? []).length > 0 && (
            <div className="system-account-list space-y-2">
              {(categoryBudgets ?? []).map((budget) => (
                <ListRow key={budget.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">{budget.category}</p>
                    <p className="text-[11px] tabular-nums text-slate-500">¥{budget.monthlyAmount.toLocaleString()} / 月</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() =>
                        setBudgetDraft({ id: budget.id, category: budget.category, amount: String(budget.monthlyAmount) })
                      }
                      className="text-xs font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDeleteBudget(budget)}
                      className="text-xs font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      削除
                    </button>
                  </div>
                </ListRow>
              ))}
            </div>
          )}

          {budgetDraft ? (
            <div className="mt-3 space-y-3 border-t border-white/40 pt-3">
              <Select
                label="カテゴリ"
                value={budgetDraft.category}
                onChange={(e) => setBudgetDraft({ ...budgetDraft, category: e.target.value })}
              >
                {budgetCategoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
              <AmountInput
                label="1か月あたりの上限"
                hint="1円以上で登録できます。"
                value={budgetDraft.amount}
                onChange={(e) => setBudgetDraft({ ...budgetDraft, amount: e.target.value })}
                min={0}
                placeholder="0"
              />
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setBudgetDraft(null)}>
                  やめる
                </Button>
                <Button className="flex-1" onClick={handleSaveBudget} disabled={!budgetDraftValid}>
                  {budgetDraft.id ? "保存" : "追加"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="system-section__actions">
              <Button
                variant="secondary"
                className="w-full"
                disabled={budgetCategoryOptions.length === 0}
                onClick={() => setBudgetDraft({ category: budgetCategoryOptions[0], amount: "" })}
              >
                {budgetCategoryOptions.length === 0
                  ? "すべてのカテゴリに設定済み"
                  : (categoryBudgets ?? []).length > 0
                    ? "+ カテゴリを追加"
                    : "カテゴリ別の予算を作る"}
              </Button>
            </div>
          )}
        </Card>

        <Card className="system-section system-section--gmail">
          <div className="system-section__header">
            <div className="system-section__identity"><span><Mail size={17} /></span><div><h2>Gmail</h2></div></div>
            <div className={`system-status ${gmailAccounts && gmailAccounts.length > 0 ? "is-online" : ""}`}><i />{gmailAccounts === undefined ? "確認中" : gmailAccounts.length > 0 ? "連携中" : "未連携"}</div>
          </div>
          <p className="system-section__description text-xs text-slate-500">
            受信メールにAIが返信案を作成します。日時が書かれているメールには「予定を追加しますか?」と提案します
            (提案するかどうかの判断は端末の中だけで行い、押したときだけ内容を読み取ります)。
            {!pushEnabled && "連携情報はこの端末にのみ保存されます。"}
          </p>
          <div className="system-state-control">
            <div><span>接続状態</span><strong>{gmailAccounts && gmailAccounts.length > 0 ? `${gmailAccounts.length} アカウント` : "未接続"}</strong></div>
            <small>{gmailAccounts && gmailAccounts.length > 0 ? "AI返信 利用可" : "AI返信 利用不可"}</small>
          </div>
          {gmailAccounts && gmailAccounts.length > 0 && (
            <div className="system-account-list space-y-2">
              {gmailAccounts.map((account) => (
                <ListRow key={account.id} className="flex items-center justify-between py-2.5">
                  <span className="truncate text-sm text-slate-700">{account.email}</span>
                  <button
                    onClick={() => handleDisconnectGmail(account)}
                    className="shrink-0 text-xs font-medium text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                  >
                    解除
                  </button>
                </ListRow>
              ))}
            </div>
          )}
          <div className="system-section__actions">
            <Button variant="secondary" className="w-full" onClick={startGmailOAuth}>
              {gmailAccounts && gmailAccounts.length > 0 ? "+ アカウントを追加" : "連携する"}
            </Button>
          </div>
        </Card>

        {isSupabaseConfigured && isPushConfigured && session && (
          <Card className="system-section system-section--notify lg:col-span-2">
            <div className="system-section__header">
              <div className="system-section__identity"><span><Bell size={17} /></span><div><h2>バックグラウンド通知</h2></div></div>
              <div className={`system-status ${pushEnabled ? "is-online" : ""}`}><i />{pushEnabled ? "有効" : "無効"}</div>
            </div>
            <p className="system-section__description text-xs text-slate-500">
              アプリを閉じていても、この端末に通知を届けます(refresh tokenなどをサーバーにも保存します)。
            </p>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/40 pt-3">
              <span className="text-sm text-slate-700">この端末で通知を受け取る</span>
              <button
                onClick={() => handleTogglePush(!pushEnabled)}
                aria-pressed={pushEnabled}
                aria-label="バックグラウンド通知を切り替え"
                disabled={pushBusy}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  pushEnabled ? "bg-accent" : "bg-slate-200"
                }`}
              >
                <span
                  className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    pushEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            {pushEnabled && (
              <div className="mt-1 space-y-1 border-t border-white/40 pt-1">
                {NOTIFICATION_CATEGORIES.map((category) => (
                  <SwitchField
                    key={category.key}
                    label={category.label}
                    checked={!disabledCategories.has(category.key)}
                    onChange={(checked) => handleToggleCategory(category.key, checked)}
                  />
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
