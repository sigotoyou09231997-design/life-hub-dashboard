import type { ReactNode } from "react";

/**
 * 空の表示に置く小さな線画(UI/UX 調査メモ 第4弾 B-6)。
 *
 * お金・タスク・メモがまだ空のあいだは、空の表示が「いちばんよく見る画面」になる。
 * アイコン1つの四角だけだと事務的なので、機能ごとに線画を1枚ずつ描いた。
 *
 * - 色は青緑1色(線=--teal-600、面=薄い青緑 / --teal-100、紙=白)。色は numbers-empty.css。
 * - 線の太さはアイコン(lucide)と同じ 1.75、端は丸。80×80 の座標で描き、表示の大きさは size。
 * - 画像ファイルにしないのは、PWA の取り置き(precache)を増やさず、色をテーマの変数で塗るため。
 * - 飾りなので読み上げない(aria-hidden)。意味は横の文で伝える。
 */
export type EmptyIllustrationKind =
  | "tasks"
  | "expense"
  | "notes"
  | "calendar"
  | "trip"
  | "subscription"
  | "diary"
  | "mail";

/** 右上の小さなきらめき。どの絵にも1つ入れて、表情を少しだけ明るくする。 */
function Sparkle({ x, y }: { x: number; y: number }) {
  return <path className="ei-sparkle" d={`M${x} ${y - 3}v6M${x - 3} ${y}h6`} />;
}

const DRAWINGS: Record<EmptyIllustrationKind, ReactNode> = {
  // タスク: 2つ済んだクリップボード。3つめの丸が空いていて「何か1つ足しますか？」につながる。
  tasks: (
    <>
      <rect className="ei-paper" x="22" y="16" width="36" height="49" rx="6" />
      <rect className="ei-accent" x="32" y="12" width="16" height="8" rx="3" />
      <path d="M28.5 31l3 3 6-6M42 31h9" />
      <path d="M28.5 43l3 3 6-6M42 43h7" />
      <circle className="ei-soft" cx="32" cy="55" r="3.4" />
      <path className="ei-soft" d="M42 55h8" />
      <Sparkle x={65} y={18} />
      <circle className="ei-dot" cx="67" cy="30" r="1.3" />
    </>
  ),
  // 支出: レシートと ¥ の硬貨。
  expense: (
    <>
      <path className="ei-paper" d="M24 14h30v45l-5-3-5 3-5-3-5 3-5-3-5 3z" />
      <path d="M30 24h15M30 32h18M30 40h10" />
      <circle className="ei-accent" cx="56" cy="54" r="11" />
      <path d="M52 49l4 5 4-5M56 54v6M52.5 56h7" />
      <Sparkle x={65} y={20} />
    </>
  ),
  // メモ: 角を折った紙と鉛筆。
  notes: (
    <>
      <path className="ei-paper" d="M26 14h22l10 10v38a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" />
      <path className="ei-accent" d="M48 14v10h10" />
      <path d="M29 33h20M29 41h22M29 49h12" />
      <path className="ei-paper" d="M51 61l14-14 4 4-14 14-5 1z" />
      <path d="M62 50l4 4" />
      <Sparkle x={66} y={19} />
    </>
  ),
  // 予定: カレンダーの1日に丸。
  calendar: (
    <>
      <rect className="ei-paper" x="17" y="20" width="46" height="42" rx="6" />
      <path d="M17 30h46M29 15v9M51 15v9" />
      <circle className="ei-accent" cx="51" cy="49" r="5.5" />
      <path
        className="ei-dots"
        d="M26 40h.01M34 40h.01M42 40h.01M50 40h.01M26 49h.01M34 49h.01M42 49h.01M26 56h.01M34 56h.01"
      />
      <Sparkle x={69} y={22} />
    </>
  ),
  // 旅行: 紙飛行機と、通ってきた点線と、雲。
  trip: (
    <>
      <path className="ei-accent" d="M16 36a5 5 0 0 1 8.5-4 6.5 6.5 0 0 1 12 2.5 4 4 0 0 1-.5 8H18a4 4 0 0 1-2-6.5z" />
      <path className="ei-trail" d="M14 62c9-8 13 4 22-3s9-15 14-19" />
      <path className="ei-paper" d="M47 31l22-10-8 23-6-8z" />
      <path d="M55 36l14-15M55 36l-1 7 4-4" />
      <Sparkle x={24} y={16} />
    </>
  ),
  // サブスク: カードと、くり返しの矢印。
  subscription: (
    <>
      <rect className="ei-paper" x="15" y="22" width="42" height="29" rx="5" />
      <path d="M15 31h42" />
      <rect className="ei-accent" x="21" y="39" width="9" height="6" rx="1.5" />
      <circle className="ei-accent" cx="57" cy="53" r="11.5" />
      <path d="M50.5 51a7 7 0 0 1 12.5-3.5M63.5 43.5v4.5H59M63.5 55a7 7 0 0 1-12.5 3.5M50.5 62.5V58H55" />
      <Sparkle x={66} y={17} />
    </>
  ),
  // 日記: 開いた本と、小さなハート。
  diary: (
    <>
      <path className="ei-paper" d="M40 25c-8-5-16-5-24-2v36c8-3 16-3 24 2z" />
      <path className="ei-paper" d="M40 25c8-5 16-5 24-2v36c-8-3-16-3-24 2z" />
      <path d="M40 25v36M22 33c4-1.2 8-1 12 .6M22 41c4-1.2 8-1 12 .6M22 49c3-.8 5-.8 8 0" />
      <path className="ei-accent" d="M52 47l-4.2-4.2a2.6 2.6 0 0 1 3.7-3.7l.5.5.5-.5a2.6 2.6 0 0 1 3.7 3.7z" />
      <Sparkle x={63} y={13} />
    </>
  ),
  // メール: 封筒と、済みの印。
  mail: (
    <>
      <rect className="ei-paper" x="15" y="26" width="48" height="33" rx="5" />
      <path d="M16.5 28.5L39 45l22.5-16.5" />
      <circle className="ei-accent" cx="62" cy="25" r="7" />
      <path d="M58.8 25.2l2.2 2.2 4-4" />
      <Sparkle x={22} y={15} />
    </>
  ),
};

interface Props {
  kind: EmptyIllustrationKind;
  /** 表示の大きさ(px)。既定 80。横並びの小さな空の表示では 64 前後にする。 */
  size?: number;
  className?: string;
}

export function EmptyIllustration({ kind, size = 80, className = "" }: Props) {
  return (
    <svg
      className={`empty-illust ${className}`.trim()}
      data-kind={kind}
      viewBox="0 0 80 80"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="ei-blob" cx="40" cy="43" r="30" />
      {DRAWINGS[kind]}
    </svg>
  );
}
