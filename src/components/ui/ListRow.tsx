import type { HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** Hover-lift / press-scale feedback for rows whose whole area is a single click target (e.g. onClick={() => onEdit(x)} on the row itself). Leave off for rows that just contain independent buttons (checkboxes, delete). */
  interactive?: boolean;
}

/** Lighter-weight row for dense lists (tasks, transactions, list items) —
 * shares Card's border/background language at a smaller radius/padding. */
export function ListRow({ className = "", interactive = false, children, ...props }: Props) {
  return (
    <div
      className={twMerge(
        "glass-row relative p-3.5",
        interactive &&
          "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
