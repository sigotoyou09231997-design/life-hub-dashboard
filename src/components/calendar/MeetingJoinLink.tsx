import { Video } from "lucide-react";
import type { MeetingLink } from "../../lib/meetingLink";

interface Props {
  link: MeetingLink;
  /**
   * pill = 一覧の行の右(「Zoomで参加」)／compact = ホームの細い行(「参加」だけ)／
   * block = 予定を開いた画面の上の、幅いっぱいのボタン。
   */
  variant?: "pill" | "compact" | "block";
  className?: string;
}

/**
 * オンライン会議の参加リンクを1回押すだけで開くボタン(2026-11-26)。
 * 中身は <a>。行全体が「編集を開く」ボタンになっている所に置くので、押した時に
 * 行の方まで反応しないよう、クリックはここで止める。
 * 新しいタブで開く(LIFE HUB の画面は残したまま、Zoom・Meet のアプリか画面へ移れるように)。
 */
export function MeetingJoinLink({ link, variant = "pill", className }: Props) {
  const text = variant === "compact" ? "参加" : `${link.service}で参加`;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`lh-join lh-join--${variant}${className ? ` ${className}` : ""}`}
      aria-label={`${link.service}で参加(新しいタブで開く)`}
      title={link.url}
      onClick={(event) => event.stopPropagation()}
    >
      <Video size={variant === "block" ? 18 : 14} aria-hidden="true" />
      <span>{text}</span>
    </a>
  );
}
