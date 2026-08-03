import type { HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge("rounded-2xl border border-slate-100 bg-white p-5 shadow-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}
