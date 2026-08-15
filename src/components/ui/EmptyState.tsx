import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { Card } from "./Card";

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  /** Wrap in a bordered/shadowed Card — use for whole-page empty states, not
   * for a small list embedded within an already-rendered page/tab. */
  card?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, card = false }: Props) {
  const content = (
    <div className="flex flex-col items-center gap-2.5 py-5 text-center sm:py-6">
      {Icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-light text-accent shadow-[inset_0_1px_rgba(255,255,255,.5)]">
          <Icon size={21} />
        </div>
      )}
      <div>
        <p className="font-semibold text-slate-900">{title}</p>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );

  return card ? <Card className="p-0">{content}</Card> : content;
}
