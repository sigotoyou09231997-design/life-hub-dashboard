import type { ReactNode } from "react";
import {
  CalendarClock,
  CalendarDays,
  CreditCard,
  FolderOpen,
  Info,
  ListChecks,
  MapPin,
  MoreHorizontal,
  ShoppingBasket,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * 見出し(caption)ごとの既定の絵(第57弾)。呼ぶ側が icon を渡さなかった時だけ使う。
 * 同じ入力画面の中で、絵の付く見出し(どこへ・いつ)と付かない見出し(だれと・そのほか)が混ざり、
 * 文字の左端もずれていたので、見出しの言葉から絵を決めてそろえた。呼ぶ側が icon を渡せば、そちらが優先。
 */
const CAPTION_ICONS: Record<string, LucideIcon> = {
  だれと: Users,
  そのほか: MoreHorizontal,
  何の支払い: Tag,
  金額と支払日: CalendarClock,
  "いくら・いつ": Wallet,
  "いつ・どこで": CalendarDays,
  "契約・無料体験": CalendarClock,
  金額の変わりかた: Wallet,
  整理のしかた: FolderOpen,
  項目: ListChecks,
  商品: ShoppingBasket,
  場所: MapPin,
  詳細: Info,
  費用: Wallet,
  何にいくら: Wallet,
  支払い: CreditCard,
  いつの給与: CalendarDays,
  いくら: Wallet,
  いつ: CalendarDays,
  分類: Tag,
};

interface Props {
  /** 面の上に置く小さな見出し。「どこへ」「いつ」など、その面が何を聞いているか。 */
  caption?: string;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

/** 関係のある項目をひとつの面にまとめる。項目を全部同じ間隔で縦に積むと、
 *  必須とおまけの区別が付かないので、意味の切れ目を面で見せる。 */
export function FormPanel({ caption, icon, className = "", children }: Props) {
  const Icon = icon ?? (caption ? CAPTION_ICONS[caption] : undefined);
  return (
    <section className={className}>
      {caption && (
        <p className="form-panel__caption">
          {Icon && <Icon size={15} strokeWidth={2.1} />}
          {caption}
        </p>
      )}
      <div className="form-panel">
        <div className="form-panel__body">{children}</div>
      </div>
    </section>
  );
}
