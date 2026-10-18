import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";
import { EmptyIllustration, type EmptyIllustrationKind } from "./EmptyIllustration";

interface Props {
  icon?: LucideIcon;
  /** 機能ごとの小さな線画(UI/UX 調査メモ 第4弾 B-6)。指定すると icon の代わりに出す。
   *  「まだ1件も無い」時に使う。検索で見つからない・通知が無いのような一時的な空には付けない。 */
  illustration?: EmptyIllustrationKind;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  /** Wrap in a bordered/shadowed Card — use for whole-page empty states, not
   * for a small list embedded within an already-rendered page/tab. */
  card?: boolean;
}

export function EmptyState({ icon: Icon, illustration, title, description, action, card = false }: Props) {
  const content = (
    // 形は1つにそろえる(第8弾 X-5、2026-10-18): 線画 64px → 題名 → 1行の説明 → ボタン1つ(幅は文字に合わせる)。上下の余白 32px。
    <div className={`empty-state spatial-empty lh-empty flex flex-col items-center gap-2.5 py-8 text-center ${illustration ? "has-illustration" : ""}`}>
      {illustration ? (
        <EmptyIllustration kind={illustration} size={64} />
      ) : (
        Icon && (
          <div className="empty-state-icon flex h-11 w-11 items-center justify-center rounded-full bg-accent-light text-accent shadow-[inset_0_1px_rgba(255,255,255,.5)]">
            <Icon size={21} />
          </div>
        )
      )}
      <div className="lh-empty__copy">
        <p className="lh-empty__title font-semibold text-slate-900">{title}</p>
        {description && <p className="lh-empty__desc mt-1 text-sm">{description}</p>}
      </div>
      {action && (
        <Button className="lh-empty__action" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );

  return card ? <Card className="p-0">{content}</Card> : content;
}
