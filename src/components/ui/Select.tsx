import type { SelectHTMLAttributes } from "react";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ label, className = "", children, ...props }: Props) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>}
      <select
        className={`spatial-field w-full min-h-11 rounded-[2px] border border-white/55 bg-white/32 px-3.5 py-2.5 text-base text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,.55)] outline-none focus:border-accent/60 focus:bg-white/55 focus:ring-2 focus:ring-accent/15 ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}
