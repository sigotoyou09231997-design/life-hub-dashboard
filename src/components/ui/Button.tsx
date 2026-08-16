import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  primary: "border border-white/25 bg-accent text-white shadow-[0_6px_18px_rgba(79,111,255,0.15)] hover:bg-[#5875ff] active:bg-accent/90 focus-visible:ring-accent",
  secondary: "border border-white/60 bg-white/35 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,.6)] hover:bg-white/50 active:bg-white/45 focus-visible:ring-accent",
  ghost: "border border-transparent bg-transparent text-slate-600 hover:bg-white/25 active:bg-white/35 focus-visible:ring-accent",
  danger: "border border-red-100/60 bg-red-50/55 text-danger active:bg-red-100 focus-visible:ring-danger",
};

const sizeClasses: Record<Size, string> = {
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3.5 text-base",
  icon: "p-2.5",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: Props) {
  return (
    <button
      className={twMerge(
        "app-button inline-flex min-h-11 items-center justify-center gap-2 rounded-none font-medium transition-all duration-200 ease-out active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:active:translate-y-0",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
