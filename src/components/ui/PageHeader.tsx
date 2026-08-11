import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  backTo?: string;
}

export function PageHeader({ title, subtitle, right, backTo }: Props) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div className="flex items-start gap-2 min-w-0">
        {backTo && (
          <Link
            to={backTo}
            aria-label="戻る"
            className="-ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ChevronLeft size={22} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
