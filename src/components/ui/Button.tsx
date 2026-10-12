import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  primary: "border border-white/25 bg-accent text-white hover:bg-[#5875ff] active:bg-accent/90 focus-visible:ring-accent",
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
  // 押した時の手応え（沈んで、ばねで戻る）は src/lib/pressFeedback.ts が .app-button に付ける
  // （UI/UX 調査メモ 第4弾 A-1）。前の active:translate-y-px（1px 下がるだけ）はやめた。
  return (
    <button
      className={twMerge(
        "app-button inline-flex min-h-11 items-center justify-center gap-2 rounded-none font-medium transition-all duration-200 ease-out disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none",
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
