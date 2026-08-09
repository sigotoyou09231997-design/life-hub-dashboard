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
    <div className="flex items-center justify-between px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div className="flex items-center gap-2">
        {backTo && (
          <Link
            to={backTo}
            aria-label="戻る"
            className="-ml-1.5 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
          >
            <ChevronLeft size={22} />
          </Link>
        )}
        <div>
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
