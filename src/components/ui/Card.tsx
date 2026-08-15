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
        "glass-card p-5",
        interactive &&
          "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
