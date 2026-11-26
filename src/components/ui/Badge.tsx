import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

// 2026-11-27(見せる品質 その3): 札の作りを1つにする — どの色も「その色の淡い面＋濃い字の丸い札」。
// 前は「仕事」(accent)の面が灰色の行と同じ色で消えて文字だけに見え、「プライベート」だけ薄緑の札に見えていた。
const toneClasses: Record<Tone, string> = {
  neutral: "bg-[#e9eeec] text-slate-600",
  success: "bg-[#e5f1ea] text-success",
  warning: "bg-[#fbf0e2] text-warning",
  danger: "bg-[#fbe9e7] text-danger",
  accent: "bg-[#dfece9] text-accent",
};

export function Badge({ tone = "neutral", className = "", children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses[tone]} ${className}`.trim()}>
      {children}
    </span>
  );
}
