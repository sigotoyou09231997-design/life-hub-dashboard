import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * 「ほかの操作」の一覧(2026-11-26「静かな白」)。
 *
 * 前は、同じ強さの全幅ボタンを縦に4つ積んでいた(旅行詳細の「経路を地図で見る」「写真・文章から追加・更新」…)。
 * 主役の操作(黒いボタン)は1画面に1つにして、残りは白い箱の中の行(右に ›)にまとめる。
 * 行は1つずつ押せるボタンのまま(名前もボタンの文字と同じ)なので、働きは変わらない。
 */
export function ActionList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="action-list" aria-label={title}>
      <h2 className="action-list__title">{title}</h2>
      <div className="action-list__card">{children}</div>
    </section>
  );
}

interface RowProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export function ActionRow({ icon: Icon, label, onClick }: RowProps) {
  return (
    <button type="button" className="action-row" onClick={onClick}>
      <span className="action-row__icon" aria-hidden="true">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span className="action-row__label">{label}</span>
      <ChevronRight className="action-row__chev" size={16} aria-hidden="true" />
    </button>
  );
}
