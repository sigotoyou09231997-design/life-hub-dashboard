import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "icon";

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-white active:bg-accent/90",
  secondary: "bg-accent-light text-accent active:bg-accent-light/70",
  ghost: "bg-transparent text-slate-600 active:bg-slate-100",
  danger: "bg-red-50 text-danger active:bg-red-100",
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
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-40",
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
