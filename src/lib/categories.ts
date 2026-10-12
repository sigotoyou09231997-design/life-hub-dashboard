export const EXPENSE_CATEGORIES = [
  "食費",
  "日用品",
  "交通費",
  "娯楽",
  "交際費",
  "医療",
  "美容",
  "教育",
  "その他",
];

export const INCOME_CATEGORIES = ["給与", "副業", "ボーナス", "臨時収入", "その他"];

/** サブスク・固定費のカテゴリ。2026-10-12 にサブスク管理(参考: サブスクBOX)へ作り替えた
 * ときに、動画・音楽などを足した。前からある「家賃」〜「その他」は登録済みの固定費が
 * 使っているので消さない。分析の色は src/components/subscriptions/categoryColors.ts。 */
export const FIXED_COST_CATEGORIES = [
  "動画",
  "音楽",
  "AI・仕事",
  "クラウド",
  "ゲーム",
  "本・雑誌",
  "買い物",
  "通信費",
  "家賃",
  "水道光熱費",
  "保険",
  "カード",
  "サブスク",
  "その他",
];

export const PAYMENT_METHODS = ["現金", "クレジットカード", "電子マネー", "銀行振込", "その他"];

export const NOTE_CATEGORIES = ["仕事", "プライベート", "重要", "その他"];

export const GOAL_CATEGORIES = ["貯金", "仕事", "健康", "学習", "その他"];
