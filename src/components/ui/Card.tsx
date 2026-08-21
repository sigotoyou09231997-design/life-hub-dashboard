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
        "glass-card spatial-module p-4 lg:p-5",
        interactive && "card-interactive",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
