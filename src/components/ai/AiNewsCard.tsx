import { ArrowUpRight } from "lucide-react";
import { timeAgoJa, type AiNewsItem } from "../../lib/aiNews";

/** 出どころごとの、写真が無い時の色(同じ出どころは、いつも同じ色)。 */
const SOURCE_TONE: Record<string, string> = {
  itmedia: "ai-news-card--tone-a",
  zenn: "ai-news-card--tone-b",
  openai: "ai-news-card--tone-c",
  google: "ai-news-card--tone-d",
  deepmind: "ai-news-card--tone-d",
  techcrunch: "ai-news-card--tone-e",
  anthropic: "ai-news-card--tone-f",
  "anthropic-eng": "ai-news-card--tone-f",
};

/** 1本の記事のカード。押すと元の記事を新しいタブで開く。 */
export function AiNewsCard({ item, compact = false }: { item: AiNewsItem; compact?: boolean }) {
  const ago = timeAgoJa(item.publishedAt);
  return (
    <a
      className={`ai-news-card ${SOURCE_TONE[item.sourceId] ?? "ai-news-card--tone-a"} ${compact ? "ai-news-card--compact" : ""}`}
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="ai-news-card__media" aria-hidden="true">
        {item.image ? (
          <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="ai-news-card__mark">{item.source.slice(0, 1)}</span>
        )}
      </span>
      <span className="ai-news-card__body">
        <span className="ai-news-card__meta">
          <span className="ai-news-card__source">{item.source}</span>
          {ago && <span>{ago}</span>}
          {item.lang === "en" && <span className="ai-news-card__lang">英語</span>}
        </span>
        <strong className="ai-news-card__title">{item.title}</strong>
        {!compact && item.summary && <span className="ai-news-card__summary">{item.summary}</span>}
      </span>
      <ArrowUpRight className="ai-news-card__go" size={15} aria-hidden="true" />
    </a>
  );
}
