import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  isDismissedFor,
  summarizeUsage,
  type UsageAlert,
  type UsageReport,
  type UsageSnapshot,
} from "../lib/featureUsage";
import { dismissUsageAlertsThisMonth, loadUsageSnapshot, readAlertDismissedMonth } from "../lib/featureUsageSource";

/**
 * 機能の使われ方を、ヘッダーのベル・ホーム・ふりかえり画面で同じ結果として共有する。
 *
 * 画面ごとに状態を持つと、ふりかえり画面で「数え直す」を押してもベルとホームが
 * 古いままになり、「今月は表示しない」を押しても片方にお知らせが残る。
 * そのため結果と「閉じた月」はモジュールに1つだけ持ち、変わったら全員に知らせる。
 */
let current: UsageSnapshot | null = null;
let failed = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

async function refreshSnapshot(force: boolean): Promise<void> {
  try {
    current = await loadUsageSnapshot({ force });
    failed = false;
  } catch (error) {
    console.error("[featureUsage] failed to load usage:", error);
    failed = true;
  }
  emit();
}

export interface UsageReportState {
  snapshot: UsageSnapshot | null;
  report: UsageReport | null;
  failed: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useUsageReport(): UsageReportState {
  const snapshot = useSyncExternalStore(subscribe, () => current, () => null);
  const hasFailed = useSyncExternalStore(subscribe, () => failed, () => false);
  const [refreshing, setRefreshing] = useState(false);

  // 当日ぶんを覚えていればそれを返すだけなので、開くたびに呼んでも問い合わせは増えない。
  useEffect(() => {
    void refreshSnapshot(false);
  }, []);

  const report = useMemo(() => (snapshot ? summarizeUsage(snapshot.counts) : null), [snapshot]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSnapshot(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { snapshot, report, failed: hasFailed, refreshing, refresh };
}

const NO_ALERTS: UsageAlert[] = [];

/** ホームとベルに出すお知らせ。「今月は表示しない」を押した月は空になる。 */
export function useUsageAlerts(): { alerts: UsageAlert[]; dismiss: () => void } {
  const { report } = useUsageReport();
  const dismissedMonth = useSyncExternalStore(subscribe, readAlertDismissedMonth, () => null);
  const dismiss = useCallback(() => {
    dismissUsageAlertsThisMonth();
    emit();
  }, []);
  const alerts = report && !isDismissedFor(dismissedMonth, Date.now()) ? report.alerts : NO_ALERTS;
  return { alerts, dismiss };
}
