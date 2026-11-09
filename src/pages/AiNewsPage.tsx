import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { AiNewsCard } from "../components/ai/AiNewsCard";
import { Tabs } from "../components/ui/Tabs";
import { useAiNews } from "../hooks/useAiNews";
import { AI_NEWS_FILTERS, filterNews, type AiNewsFilter } from "../lib/aiNews";

export default function AiNewsPage() {
  const { items, loading, failed, refresh } = useAiNews();
  const [filter, setFilter] = useState<AiNewsFilter>("all");
  const shown = filterNews(items, filter);

  return (
    <div className="spatial-page ai-news-page micro-contrast mx-auto max-w-[1100px] pb-10 lg:pb-8">
      <PageHeader
        title="AIの最新情報"
        subtitle="公式の発表とニュースサイトから"
        backTo="/"
        right={
          <button type="button" className="ai-news-refresh" onClick={() => void refresh()} disabled={loading} aria-label="最新の情報に更新する">
            <RefreshCw size={16} className={loading ? "ai-news-refresh__spin" : ""} />
          </button>
        }
      />

      <div className="spatial-page-content space-y-4 px-5 lg:px-8">
        <Tabs options={AI_NEWS_FILTERS.map((f) => ({ value: f.key, label: f.label }))} value={filter} onChange={setFilter} />

        {failed && (
          <p className="ai-news-note" role="status">
            {items.length > 0 ? "最新の情報を取れませんでした。前に取れた記事を出しています。" : "記事を取れませんでした。通信を確かめて、右上の更新を押してください。"}
          </p>
        )}
        {loading && items.length === 0 && <p className="ai-news-note">読み込み中…</p>}

        {shown.length > 0 && (
          <div className="ai-news-grid">
            {shown.map((item) => (
              <AiNewsCard key={item.url} item={item} />
            ))}
          </div>
        )}
        {!loading && !failed && items.length > 0 && shown.length === 0 && <p className="ai-news-note">この絞り込みに当てはまる記事はありません。</p>}

        <p className="ai-news-foot">
          記事は元のサイトで開きます。英語の記事はそのまま英語で出ます。Anthropic は RSS を出していないため、ここには入っていません。
        </p>
      </div>
    </div>
  );
}
