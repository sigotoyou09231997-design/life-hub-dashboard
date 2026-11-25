// 画面の確認用のお手本データ(予定・タスク・家計・サブスク・メモ・日記・旅行・就活など)を、Dexie へ入れる。
// scripts/probe.mjs・scripts/ui-check.mjs の `--seed demo` が使う(2026-10-13)。**本物のデータには触らない**
// (開発用サーバーの、ログイン無しの端末の中だけ)。
//
// 中身は、アプリのデモモード(`/demo`)と同じ src/lib/demoSeed.ts を、開発サーバーから読み込んで使う(2026-11-26)。
// 以前はここに同じデータを写していたが、メモのチェック項目(text→title)と買い物の購入済み(checked→purchased)が
// 型と食い違っていた。型チェックの効く1か所にまとめた。
export const DEMO_TRIP_ID = "demo-trip-1";
export const DEMO_TRIP2_ID = "demo-trip-2";

export async function seed(page) {
  await page.evaluate(async () => {
    const { db } = await import("/src/db/schema.ts");
    const { seedDemoData } = await import("/src/lib/demoSeed.ts");
    await seedDemoData(db);
  });
}
