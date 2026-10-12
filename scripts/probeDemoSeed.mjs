// 画面の確認用のお手本データ(予定・タスク・家計・サブスク・メモ・日記・旅行・就活など)を、Dexie へ入れる。
// scripts/probe.mjs の `--seed demo` が使う(2026-10-13)。中身は、親フォルダの全画面スクショ用の種まき
// (scripts/lifehub-shots.mjs)と同じものを、todoアプリのリポジトリの中へ写した。**本物のデータには触らない**
// (開発用サーバーの、ログイン無しの端末の中だけ)。
export const DEMO_TRIP_ID = "demo-trip-1";
export const DEMO_TRIP2_ID = "demo-trip-2";

export async function seed(page, ids) {
  await page.evaluate(async ({ TRIP_ID, TRIP2_ID }) => {
    const { db } = await import("/src/db/schema.ts");
    const now = Date.now();
    const d = (offset) => {
      const t = new Date();
      t.setDate(t.getDate() + offset);
      return t.toISOString().slice(0, 10);
    };
    const month = d(0).slice(0, 7);
    const stamp = (row) => ({ createdAt: now, updatedAt: now, ...row });

    // 何度開き直しても同じ絵になるように、毎回まっさらにしてから入れる。
    const tables = [
      "calendarEvents", "tasks", "transactions", "fixedCosts", "salaries", "notes",
      "diaryEntries", "trips", "tripSchedule", "tripExpenses", "tripPackingItems",
      "tripRoutePlaces", "jobApplications", "categoryBudgets", "savingsGoals",
    ];
    for (const t of tables) await db[t].clear();
    // サブスクの付け足し(2026-10-12〜)。それより前のブランチを撮る時は無いので飛ばす。
    if (db.subscriptionDetails) await db.subscriptionDetails.clear();

    await db.calendarEvents.bulkPut([
      stamp({ title: "チームの定例", date: d(0), startTime: "10:00", endTime: "11:00", category: "work", location: "会議室A" }),
      stamp({ title: "歯医者", date: d(0), startTime: "18:30", endTime: "19:15", category: "private", location: "駅前クリニック" }),
      stamp({ title: "友人と夕食", date: d(1), startTime: "19:00", category: "private", location: "新宿" }),
      stamp({ title: "健康診断", date: d(3), startTime: "09:00", category: "important", memo: "朝食は抜く" }),
      stamp({ title: "出張（大阪）", date: d(5), endDate: d(7), allDay: true, category: "work" }),
      stamp({ title: "家賃の引き落とし", date: d(9), allDay: true, category: "other" }),
      stamp({ title: "資格の勉強会", date: d(-2), startTime: "20:00", category: "private" }),
    ]);

    await db.tasks.bulkPut([
      stamp({ title: "請求書をまとめて送る", priority: "high", dueDate: d(0), dueTime: "17:00", completed: false, repeat: "none", category: "work" }),
      stamp({ title: "洗剤とゴミ袋を買う", priority: "low", dueDate: d(0), completed: false, repeat: "none", category: "private" }),
      stamp({ title: "旅行の宿を予約する", priority: "high", dueDate: d(2), completed: false, repeat: "none", category: "private" }),
      stamp({ title: "資料のレビュー依頼", priority: "medium", dueDate: d(1), completed: false, repeat: "none", category: "work" }),
      stamp({ title: "ゴミ出し", priority: "low", dueDate: d(0), completed: true, completedAt: now, repeat: "weekly", category: "private" }),
      stamp({ title: "電気代を払う", priority: "medium", dueDate: d(-1), completed: true, completedAt: now, repeat: "monthly", category: "other" }),
      stamp({ title: "本を返す", priority: "low", dueDate: d(4), completed: false, repeat: "none", category: "private" }),
    ]);

    const spend = [
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
        stamp({ type: "expense", amount, category, store, date, isFixed: false, method: "PayPay" })),
      stamp({ type: "income", amount: 32000, category: "副業", date: d(-7), isFixed: false }),
    ]);

    const fixed = (id, title, category, amount, dueDay, active = true) =>
      ({ id, title, category, amount, dueDay, active, updatedAt: now });
    await db.fixedCosts.bulkPut([
      fixed("fc-rent", "家賃", "家賃", 78000, 27),
      fixed("fc-phone", "スマホ", "通信費", 3980, 10),
      fixed("fc-netflix", "Netflix", "動画", 1590, Number(d(8).slice(8, 10))),
      fixed("fc-spotify", "Spotify", "音楽", 1080, Number(d(2).slice(8, 10))),
      fixed("fc-chatgpt", "ChatGPT", "AI・仕事", 3000, Number(d(1).slice(8, 10))),
      fixed("fc-icloud", "iCloud+", "クラウド", 540, 2),
      fixed("fc-prime", "Amazonプライム", "買い物", 5900, 15),
      fixed("fc-switch", "Nintendo Switch Online", "ゲーム", 3000, 3),
      fixed("fc-unext", "U-NEXT", "動画", 2189, Number(d(9).slice(8, 10))),
      fixed("fc-hulu", "Hulu", "動画", 1320, 1, false),
    ]);
    if (db.subscriptionDetails) {
      const detail = (fixedCostId, fields) => ({ fixedCostId, cycle: "monthly", createdAt: now, updatedAt: now, ...fields });
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
    }

    await db.salaries.bulkPut([
      stamp({ month, payday: 25, amount: 268000 }),
      stamp({ month: new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7), payday: 25, amount: 262000 }),
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
      stamp({ type: "memo", title: "打ち合わせのメモ", body: "次回までに見積もりを出す。デザインは暖色寄りで、写真を大きく使う方向で合意。", tags: ["仕事"], pinned: true }),
      stamp({ type: "checklist", title: "引っ越しの準備", body: "", tags: ["暮らし"], pinned: false,
        checklistItems: [
          { id: "c1", text: "住所変更", checked: true },
          { id: "c2", text: "ネット回線の移転", checked: false },
          { id: "c3", text: "粗大ごみの申し込み", checked: false },
        ] }),
      stamp({ type: "shopping", title: "週末の買い物", body: "", tags: ["買い物"], pinned: false,
        shoppingItems: [
          { id: "s1", name: "牛乳", quantity: 1, checked: false },
          { id: "s2", name: "洗剤", quantity: 2, checked: true },
          { id: "s3", name: "パン", quantity: 1, checked: false },
        ] }),
      stamp({ type: "memo", title: "読みたい本", body: "・デザインの本\n・写真の構図の本", tags: ["趣味"], pinned: false }),
    ]);

    await db.diaryEntries.bulkPut([
      stamp({ date: d(0), body: "新しいデザインの下書きができた。暖かい色だと画面がやわらかく見える。", mood: "good", placeLabel: "自宅" }),
      stamp({ date: d(-1), body: "夕方から雨。早めに切り上げて読書。", mood: "normal" }),
      stamp({ date: d(-4), body: "海がきれいだった。写真をたくさん撮った。", mood: "good", tripId: TRIP_ID, placeLabel: "江ノ島" }),
    ]);

    await db.trips.bulkPut([
      stamp({ id: TRIP_ID, name: "秋の京都", destination: "京都", startDate: d(6), endDate: d(9), status: "planning", budget: 80000, memo: "紅葉の時期。宿は四条あたり。" }),
      stamp({ id: TRIP2_ID, name: "冬の温泉", destination: "草津", startDate: d(60), endDate: d(62), status: "planning", budget: 50000 }),
    ]);
    await db.tripSchedule.bulkPut([
      stamp({ tripId: TRIP_ID, date: d(6), startTime: "08:30", endTime: "11:00", title: "新幹線で移動", type: "transport", location: "東京→京都" }),
      stamp({ tripId: TRIP_ID, date: d(6), startTime: "12:00", title: "昼食（湯葉）", type: "meal", location: "南禅寺周辺" }),
      stamp({ tripId: TRIP_ID, date: d(6), endDate: d(8), startTime: "16:00", title: "宿にチェックイン", type: "lodging", location: "四条のホテル" }),
      stamp({ tripId: TRIP_ID, date: d(7), startTime: "09:00", endTime: "10:30", title: "清水寺", type: "sightseeing", location: "清水" }),
      stamp({ tripId: TRIP_ID, date: d(7), startTime: "11:30", endTime: "12:15", title: "八坂神社", type: "sightseeing", location: "八坂神社" }),
      stamp({ tripId: TRIP_ID, date: d(7), startTime: "14:00", title: "嵐山を歩く", type: "sightseeing" }),
      stamp({ tripId: TRIP_ID, date: d(8), startTime: "10:00", title: "伏見稲荷", type: "sightseeing" }),
    ]);
    await db.tripExpenses.bulkPut([
      stamp({ tripId: TRIP_ID, title: "新幹線（往復）", amount: 28000, category: "transport", paid: true, paidDate: d(-3) }),
      stamp({ tripId: TRIP_ID, title: "宿（3泊）", amount: 36000, category: "lodging", paid: false }),
      stamp({ tripId: TRIP_ID, title: "食事の予算", amount: 12000, category: "meal", paid: false }),
    ]);
    await db.tripPackingItems.bulkPut([
      stamp({ tripId: TRIP_ID, title: "充電器", category: "electronics", checked: true }),
      stamp({ tripId: TRIP_ID, title: "上着", category: "clothing", checked: false }),
      stamp({ tripId: TRIP_ID, title: "常備薬", category: "essentials", checked: false }),
      stamp({ tripId: TRIP_ID, title: "身分証", category: "documents", checked: true }),
    ]);
    await db.tripRoutePlaces.bulkPut([
      stamp({ tripId: TRIP_ID, name: "清水寺", address: "京都市東山区清水1丁目294", sortOrder: 1, date: d(7), visited: false }),
      stamp({ tripId: TRIP_ID, name: "八坂神社", address: "京都市東山区祇園町北側625", sortOrder: 2, date: d(7), visited: false }),
      stamp({ tripId: TRIP_ID, name: "嵐山 竹林の小径", address: "京都市右京区嵯峨天龍寺芒ノ馬場町", sortOrder: 3, date: d(7), visited: false }),
    ]);

    await db.jobApplications.bulkPut([
      stamp({ companyName: "株式会社アオイ", role: "Webエンジニア", stage: "interview1", nextDate: d(2), nextTime: "14:00", memo: "オンライン。逆質問を3つ用意する。" }),
      stamp({ companyName: "ミドリ工業", role: "社内SE", stage: "document", nextDate: d(5) }),
      stamp({ companyName: "そらデザイン", role: "UIデザイナー", stage: "applied" }),
      stamp({ companyName: "ハルカ商事", stage: "offer", memo: "返事は今週中" }),
    ]);
  }, ids);
}
