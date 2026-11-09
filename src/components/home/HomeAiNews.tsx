import { Sparkles, type LucideIcon } from "lucide-react";
import { AiNewsCard } from "../ai/AiNewsCard";
import { useAiNews } from "../../hooks/useAiNews";
import { pickHomeNews } from "../../lib/aiNews";

/** ホームの「AIの最新情報」。記事が1つも無い(取れていない)間は、場所ごと出さない。 */
export function HomeAiNews({ head }: { head: (props: { title: string; to: string; icon: LucideIcon }) => JSX.Element }) {
  const { items } = useAiNews();
  const picks = pickHomeNews(items);
  if (picks.length === 0) return null;
  return (
    <section className="lh-section lh-section--ainews" data-reveal="6">
      {head({ title: "AIの最新情報", to: "/ai-news", icon: Sparkles })}
      <div className="ai-news-row">
        {picks.map((item) => (
          <AiNewsCard key={item.url} item={item} compact />
        ))}
      </div>
    </section>
  );
}
