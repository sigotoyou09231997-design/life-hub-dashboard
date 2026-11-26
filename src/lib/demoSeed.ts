// デモモード(src/lib/demoMode.ts)の見本のデータ。予定・タスク・家計・サブスク・メモ・日記・旅行・就活の
// 全画面ぶんを、デモ専用のDB(life-hub-demo)へ入れる。本物のDBには入れない(呼ぶ側が IS_DEMO の時だけ呼ぶ)。
//
// 中身は、画面の確認用のお手本(scripts/probeDemoSeed.mjs・全画面スクショ)と同じもの。日付は「今日から何日」で
// 決めるので、いつ開いても今週の予定として見える。人の名前・会社名・お店はすべて架空。
import type { LifeHubDB } from "../db/schema";
import { demoDraftReplies, demoGmailAccount, demoSyncedEmails } from "./demoMail";

export const DEMO_TRIP_ID = "demo-trip-1";
export const DEMO_TRIP2_ID = "demo-trip-2";

/** 見本で上書きする表。何度入れ直しても同じ絵になるよう、入れる前に空にする。 */
const DEMO_TABLES = [
  "calendarEvents",
  "tasks",
  "transactions",
  "fixedCosts",
  "salaries",
  "notes",
  "diaryEntries",
  "trips",
  "tripSchedule",
  "tripExpenses",
  "tripPackingItems",
  "tripRoutePlaces",
  "jobApplications",
  "categoryBudgets",
  "savingsGoals",
  "subscriptionDetails",
  // Gmail の見本(2026-11-27。受信メールと AI 返信案を見せる。src/lib/demoMail.ts)。
  "gmailAccounts",
  "syncedEmails",
  "draftReplies",
] as const;

function dayOffset(base: Date, offset: number): string {
  const t = new Date(base);
  t.setDate(t.getDate() + offset);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 見本のデータを入れ直す。`today` はテスト用(ふだんは今日)。 */
export async function seedDemoData(db: LifeHubDB, today: Date = new Date()): Promise<void> {
  const now = today.getTime();
  const d = (offset: number) => dayOffset(today, offset);
  const dayOfMonth = (offset: number) => Number(d(offset).slice(8, 10));
  const month = d(0).slice(0, 7);
  const lastMonthDate = new Date(today);
  lastMonthDate.setDate(1);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = dayOffset(lastMonthDate, 0).slice(0, 7);
  const stamp = <T extends object>(row: T) => ({ createdAt: now, updatedAt: now, ...row });

  await db.transaction("rw", DEMO_TABLES.map((name) => db.table(name)), async () => {
    for (const name of DEMO_TABLES) await db.table(name).clear();

    await db.calendarEvents.bulkPut([
      stamp({ title: "チームの定例", date: d(0), startTime: "10:00", endTime: "11:00", category: "work" as const, location: "会議室A" }),
      stamp({ title: "歯医者", date: d(0), startTime: "18:30", endTime: "19:15", category: "private" as const, location: "駅前クリニック" }),
      stamp({ title: "友人と夕食", date: d(1), startTime: "19:00", category: "private" as const, location: "新宿" }),
      stamp({ title: "健康診断", date: d(3), startTime: "09:00", category: "important" as const, memo: "朝食は抜く" }),
      stamp({ title: "出張（大阪）", date: d(5), endDate: d(7), allDay: true, category: "work" as const }),
      stamp({ title: "家賃の引き落とし", date: d(9), allDay: true, category: "other" as const }),
      stamp({ title: "資格の勉強会", date: d(-2), startTime: "20:00", category: "private" as const }),
    ]);

    await db.tasks.bulkPut([
      stamp({ title: "請求書をまとめて送る", priority: "high" as const, dueDate: d(0), dueTime: "17:00", completed: false, repeat: "none" as const, category: "work" as const }),
      stamp({ title: "洗剤とゴミ袋を買う", priority: "low" as const, dueDate: d(0), completed: false, repeat: "none" as const, category: "private" as const }),
      stamp({ title: "旅行の宿を予約する", priority: "high" as const, dueDate: d(2), completed: false, repeat: "none" as const, category: "private" as const }),
      stamp({ title: "資料のレビュー依頼", priority: "medium" as const, dueDate: d(1), completed: false, repeat: "none" as const, category: "work" as const }),
      stamp({ title: "ゴミ出し", priority: "low" as const, dueDate: d(0), completed: true, completedAt: now, repeat: "weekly" as const, category: "private" as const }),
      stamp({ title: "電気代を払う", priority: "medium" as const, dueDate: d(-1), completed: true, completedAt: now, repeat: "monthly" as const, category: "other" as const }),
      stamp({ title: "本を返す", priority: "low" as const, dueDate: d(4), completed: false, repeat: "none" as const, category: "private" as const }),
    ]);

    const spend: Array<[string, number, string, string]> = [
      ["食費", 1280, "コンビニ", d(0)], ["食費", 3480, "スーパー", d(-1)],
      ["食費", 980, "ランチ", d(-2)], ["日用品", 2150, "ドラッグストア", d(-3)],
      ["交通費", 760, "電車", d(-1)], ["娯楽", 1900, "映画", d(-5)],
      ["交際費", 5400, "飲み会", d(-6)], ["美容", 4200, "美容室", d(-8)],
      ["医療", 1560, "歯科", d(-10)], ["食費", 2680, "スーパー", d(-11)],
      ["日用品", 3300, "ネット通販", d(-13)], ["交通費", 1200, "タクシー", d(-15)],
      ["娯楽", 2480, "書籍", d(-17)], ["その他", 900, "雑費", d(-19)],
    ];
    await db.transactions.bulkPut([
      ...spend.map(([category, amount, store, date]) =>
        stamp({ type: "expense" as const, amount, category, store, date, isFixed: false, method: "PayPay" })),
      stamp({ type: "income" as const, amount: 32000, category: "副業", date: d(-7), isFixed: false }),
    ]);

    const fixed = (id: string, title: string, category: string, amount: number, dueDay: number, active = true) =>
      ({ id, title, category, amount, dueDay, active, updatedAt: now });
    await db.fixedCosts.bulkPut([
      fixed("fc-rent", "家賃", "家賃", 78000, 27),
      fixed("fc-phone", "スマホ", "通信費", 3980, 10),
      fixed("fc-netflix", "Netflix", "動画", 1590, dayOfMonth(8)),
      fixed("fc-spotify", "Spotify", "音楽", 1080, dayOfMonth(2)),
      fixed("fc-chatgpt", "ChatGPT", "AI・仕事", 3000, dayOfMonth(1)),
      fixed("fc-icloud", "iCloud+", "クラウド", 540, 2),
      fixed("fc-prime", "Amazonプライム", "買い物", 5900, 15),
      fixed("fc-switch", "Nintendo Switch Online", "ゲーム", 3000, 3),
      fixed("fc-unext", "U-NEXT", "動画", 2189, dayOfMonth(9)),
      fixed("fc-hulu", "Hulu", "動画", 1320, 1, false),
    ]);
    const detail = (fixedCostId: string, fields: Record<string, unknown>) =>
      ({ fixedCostId, cycle: "monthly" as const, createdAt: now, updatedAt: now, ...fields });
    await db.subscriptionDetails.bulkPut([
      detail("fc-netflix", { serviceKey: "netflix-standard" }),
      detail("fc-spotify", { serviceKey: "spotify-standard" }),
      detail("fc-chatgpt", { serviceKey: "chatgpt-plus" }),
      detail("fc-icloud", { serviceKey: "icloud-200" }),
      detail("fc-prime", { serviceKey: "amazon-prime-yearly", cycle: "yearly", billingMonth: 4 }),
      detail("fc-switch", { serviceKey: "nso-yearly", cycle: "yearly", billingMonth: 11 }),
      detail("fc-unext", { serviceKey: "unext", trialEndDate: d(9) }),
      detail("fc-hulu", { serviceKey: "hulu", cancelledAt: d(-50) }),
    ]);

    await db.salaries.bulkPut([
      stamp({ month, payday: 25, amount: 268000 }),
      stamp({ month: lastMonth, payday: 25, amount: 262000 }),
    ]);

    await db.categoryBudgets.bulkPut([
      stamp({ category: "食費", monthlyAmount: 30000 }),
      stamp({ category: "娯楽", monthlyAmount: 10000 }),
      stamp({ category: "交際費", monthlyAmount: 15000 }),
    ]);
    await db.savingsGoals.bulkPut([
      stamp({ name: "旅行用", monthlyAmount: 20000 }),
      stamp({ name: "生活防衛費", monthlyAmount: 15000 }),
    ]);

    await db.notes.bulkPut([
      stamp({ type: "memo" as const, title: "打ち合わせのメモ", body: "次回までに見積もりを出す。デザインは暖色寄りで、写真を大きく使う方向で合意。", tags: ["仕事"], pinned: true }),
      stamp({
        type: "checklist" as const, title: "引っ越しの準備", body: "", tags: ["暮らし"], pinned: false,
        checklistItems: [
          { id: "c1", title: "住所変更", checked: true },
          { id: "c2", title: "ネット回線の移転", checked: false },
          { id: "c3", title: "粗大ごみの申し込み", checked: false },
        ],
      }),
      stamp({
        type: "shopping" as const, title: "週末の買い物", body: "", tags: ["買い物"], pinned: false,
        shoppingItems: [
          { id: "s1", name: "牛乳", quantity: 1, purchased: false },
          { id: "s2", name: "洗剤", quantity: 2, purchased: true },
          { id: "s3", name: "パン", quantity: 1, purchased: false },
        ],
      }),
      stamp({ type: "memo" as const, title: "読みたい本", body: "・デザインの本\n・写真の構図の本", tags: ["趣味"], pinned: false }),
    ]);

    await db.diaryEntries.bulkPut([
      stamp({ date: d(0), body: "新しいデザインの下書きができた。暖かい色だと画面がやわらかく見える。", mood: "good" as const, placeLabel: "自宅" }),
      stamp({ date: d(-1), body: "夕方から雨。早めに切り上げて読書。", mood: "normal" as const }),
      stamp({ date: d(-4), body: "海がきれいだった。写真をたくさん撮った。", mood: "good" as const, tripId: DEMO_TRIP_ID, placeLabel: "江ノ島" }),
    ]);

    await db.trips.bulkPut([
      stamp({ id: DEMO_TRIP_ID, name: "秋の京都", destination: "京都", startDate: d(6), endDate: d(9), status: "planning" as const, budget: 80000, memo: "紅葉の時期。宿は四条あたり。" }),
      stamp({ id: DEMO_TRIP2_ID, name: "冬の温泉", destination: "草津", startDate: d(60), endDate: d(62), status: "planning" as const, budget: 50000 }),
    ]);
    await db.tripSchedule.bulkPut([
      // 場所・住所は、下のルートの場所と同じにそろえる(2026-11-27)。前は日程の「清水」とルートの「清水寺」がずれて、
      // ルートに入っている場所が「まだ入っていない場所」に出たり、時間で見た時に時刻が付かなかったりした。
      stamp({ tripId: DEMO_TRIP_ID, date: d(6), startTime: "08:30", endTime: "11:00", title: "新幹線で京都へ", type: "transport", location: "京都駅", address: "京都府京都市下京区東塩小路町" }),
      stamp({ tripId: DEMO_TRIP_ID, date: d(6), startTime: "12:00", title: "昼食（湯葉）", type: "meal", location: "南禅寺周辺", address: "京都府京都市左京区南禅寺福地町", openingHours: "11:00〜15:00" }),
      stamp({ tripId: DEMO_TRIP_ID, date: d(6), endDate: d(8), startTime: "16:00", title: "宿にチェックイン", type: "lodging", location: "四条のホテル", address: "京都府京都市下京区四条通烏丸" }),
      stamp({ tripId: DEMO_TRIP_ID, date: d(7), startTime: "09:00", endTime: "10:30", title: "清水寺", type: "sightseeing", location: "清水寺", address: "京都市東山区清水1丁目294" }),
      stamp({ tripId: DEMO_TRIP_ID, date: d(7), startTime: "11:30", endTime: "12:15", title: "八坂神社", type: "sightseeing", location: "八坂神社", address: "京都市東山区祇園町北側625" }),
      stamp({ tripId: DEMO_TRIP_ID, date: d(7), startTime: "14:00", endTime: "15:30", title: "嵐山を歩く", type: "sightseeing", location: "嵐山 竹林の小径", address: "京都市右京区嵯峨天龍寺芒ノ馬場町" }),
      stamp({ tripId: DEMO_TRIP_ID, date: d(8), startTime: "10:00", title: "伏見稲荷", type: "sightseeing", location: "伏見稲荷大社", address: "京都市伏見区深草藪之内町68" }),
    ]);
    await db.tripExpenses.bulkPut([
      stamp({ tripId: DEMO_TRIP_ID, title: "新幹線（往復）", amount: 28000, category: "transport", paid: true, paidDate: d(-3) }),
      stamp({ tripId: DEMO_TRIP_ID, title: "宿（3泊）", amount: 36000, category: "lodging", paid: false }),
      stamp({ tripId: DEMO_TRIP_ID, title: "食事の予算", amount: 12000, category: "meal", paid: false }),
    ]);
    await db.tripPackingItems.bulkPut([
      stamp({ tripId: DEMO_TRIP_ID, title: "充電器", category: "electronics", checked: true }),
      stamp({ tripId: DEMO_TRIP_ID, title: "上着", category: "clothing", checked: false }),
      stamp({ tripId: DEMO_TRIP_ID, title: "常備薬", category: "essentials", checked: false }),
      stamp({ tripId: DEMO_TRIP_ID, title: "身分証", category: "documents", checked: true }),
    ]);
    await db.tripRoutePlaces.bulkPut([
      stamp({ tripId: DEMO_TRIP_ID, name: "清水寺", address: "京都市東山区清水1丁目294", sortOrder: 1, date: d(7), visited: false }),
      stamp({ tripId: DEMO_TRIP_ID, name: "八坂神社", address: "京都市東山区祇園町北側625", sortOrder: 2, date: d(7), visited: false }),
      stamp({ tripId: DEMO_TRIP_ID, name: "嵐山 竹林の小径", address: "京都市右京区嵯峨天龍寺芒ノ馬場町", sortOrder: 3, date: d(7), visited: false }),
    ]);

    // Gmail の見本(受信メール5通・AI 返信案2通)。デモでは通信しない(src/lib/demoMail.ts)。
    await db.gmailAccounts.bulkPut([demoGmailAccount(now)]);
    await db.syncedEmails.bulkPut(demoSyncedEmails(now));
    await db.draftReplies.bulkPut(demoDraftReplies(now));

    await db.jobApplications.bulkPut([
      stamp({ companyName: "株式会社アオイ", role: "Webエンジニア", stage: "interview1" as const, nextDate: d(2), nextTime: "14:00", memo: "オンライン。逆質問を3つ用意する。" }),
      stamp({ companyName: "ミドリ工業", role: "社内SE", stage: "document" as const, nextDate: d(5) }),
      stamp({ companyName: "そらデザイン", role: "UIデザイナー", stage: "applied" as const }),
      stamp({ companyName: "ハルカ商事", stage: "offer" as const, memo: "返事は今週中" }),
    ]);
  });
}
