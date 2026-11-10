import {
  Banknote,
  Bus,
  Clapperboard,
  Gift,
  GraduationCap,
  HeartPulse,
  Package,
  ShoppingBasket,
  Sparkles,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * 支出・収入のカテゴリを、1文字の札ではなく小さな絵で見せる(第33弾)。
 * 参考: @MAQIB135「色のついた頭文字の札を、見分けやすい単純なアイコンに替えた」。
 * 知らないカテゴリ(自分で足したもの)は、今までどおり頭文字にする。
 */
const ICONS: Record<string, LucideIcon> = {
  食費: Utensils,
  日用品: ShoppingBasket,
  交通費: Bus,
  娯楽: Clapperboard,
  交際費: Gift,
  医療: HeartPulse,
  美容: Sparkles,
  教育: GraduationCap,
  その他: Package,
  給与: Banknote,
  副業: Wallet,
  ボーナス: Banknote,
  臨時収入: Wallet,
};

export function categoryIconFor(category: string): LucideIcon | null {
  return ICONS[category] ?? null;
}

export function CategoryIcon({ category }: { category: string }) {
  const Icon = categoryIconFor(category);
  return Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" /> : <>{category.slice(0, 1)}</>;
}
