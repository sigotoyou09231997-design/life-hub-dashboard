import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

const toneClasses: Record<Tone, string> = {
  // 2026-11-27: 白いカードの上で地が見えず、文字だけが 8px 右にずれて見えていた(メモの「#仕事」など)。薄い灰の札にする。
  neutral: "bg-[#f3f5f4] text-slate-600",
  success: "bg-green-50 text-success",
  warning: "bg-amber-50 text-warning",
  danger: "bg-red-50 text-danger",
  accent: "bg-accent-light text-accent",
};

export function Badge({ tone = "neutral", className = "", children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses[tone]} ${className}`.trim()}>
      {children}
    </span>
  );
}
