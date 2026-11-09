import { useCallback, useEffect, useState } from "react";
import { AI_NEWS_FRESH_MS, fetchAiNews, loadCachedNews, type AiNewsItem } from "../lib/aiNews";

/**
 * AIニュースの一覧。端末に覚えた一覧をまず出し、古ければ裏で取り直す(取れなくても、覚えた一覧は消さない)。
 * `enabled` が false の間は何も取らない。
 */
export function useAiNews(enabled = true) {
  const cached = typeof window === "undefined" ? null : loadCachedNews();
  const [items, setItems] = useState<AiNewsItem[]>(cached?.items ?? []);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchAiNews());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const fresh = cached && Date.now() - cached.at < AI_NEWS_FRESH_MS;
    if (!fresh) void refresh();
    // 開いた時に1回だけ判断する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { items, loading, failed, refresh };
}
