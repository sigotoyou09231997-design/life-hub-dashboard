import type { HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** Hover-lift / press-scale feedback for cards that sit inside a Link or button (whole card is one click target). */
  interactive?: boolean;
}

export function Card({ className = "", interactive = false, children, ...props }: Props) {
  return (
    <div
      className={twMerge(
        "rounded-2xl border border-slate-100 bg-white p-5 shadow-sm",
        interactive &&
          "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
