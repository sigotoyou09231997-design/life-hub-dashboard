import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  backTo?: string;
}

const BACK_BUTTON_CLASS =
  "-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors active:bg-slate-900/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

export function PageHeader({ title, subtitle, right, backTo }: Props) {
  return (
    // Safe-area top spacing is handled once by the global AppHeader above this;
    // this only needs a normal-flow gap beneath it.
    <div className="spatial-page-header flex items-center justify-between gap-3 px-5 pb-4 pt-6 lg:px-8 lg:pb-5 lg:pt-7">
      <div className="flex items-center gap-2 min-w-0">
        {backTo && (
          <Link to={backTo} aria-label="戻る" className={`${BACK_BUTTON_CLASS} ${backTo === "/" ? "lg:hidden" : ""}`}>
            <ChevronLeft size={22} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="spatial-page-header__title text-xl font-semibold tracking-[-0.02em] text-slate-900 lg:text-[1.65rem]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
