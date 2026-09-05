import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { MapPin } from "lucide-react";
import { fetchSharedTrip, type SharedTrip } from "../lib/tripShare";
import { formatDisplayDate, tripDayList, tripDurationLabel } from "../lib/date";
import {
  getTripExpenseCategory,
  getTripPackingCategory,
  getTripScheduleType,
} from "../lib/tripCategories";
import type { TripExpenseCategory, TripPackingCategory, TripScheduleType } from "../types";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { formatOriginalAmount } from "../lib/currency";

/**
 * 共有リンクで開く、ログイン不要の閲覧専用ページ(supabase/sql/023_trip_shares.sql)。
 *
 * アプリ本体の画面ではないので、ヘッダー・サイドバー・タブは出さず、上から下に
 * 読むだけの1枚にしている。編集の入り口はどこにも無い。日記は共有の対象外なので、
 * 設定に関わらずここには出てこない。
 */
export default function SharedTripPage() {
  const { token } = useParams();
  const [state, setState] = useState<{ status: "loading" | "ended" | "error" | "ready"; data?: SharedTrip }>({
    status: "loading",
  });

  // 検索エンジンに拾わせない(2026-09-04の指示)。リンクを知っている人だけが見る前提の
  // ページなので、公開されている＝誰でも探せる、にはしない。public/robots.txt でも
  // /share/ を拒否しているが、robots.txt を見ないクローラのためにこちらにも出す。
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ status: "ended" });
      return;
    }
    let active = true;
    void (async () => {
      try {
        const data = await fetchSharedTrip(token);
        if (!active) return;
        setState(data ? { status: "ready", data } : { status: "ended" });
      } catch (error) {
        console.error("[share] failed to load shared trip:", error);
        if (active) setState({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const data = state.data;
  useEffect(() => {
    document.title = data ? `${data.trip.name} — LIFE HUB` : "LIFE HUB";
    return () => {
      document.title = "LIFE HUB";
    };
  }, [data?.trip.name]);

  // 日程は日にちごとにまとめる。またがる日程(2泊の宿泊など)は、その間の日すべてに出す
  // ——アプリ側の TripScheduleList と同じ見え方に合わせる。
  const scheduleByDay = useMemo(() => {
    if (!data) return [];
    return tripDayList(data.trip.startDate, data.trip.endDate).map((date) => ({
      date,
      items: data.schedule.filter((item) => date >= item.date && date <= (item.endDate || item.date)),
    }));
  }, [data]);

  const expenseTotal = useMemo(
    () => (data ? data.expenses.reduce((sum, expense) => sum + expense.amount, 0) : 0),
    [data],
  );

  if (state.status === "loading") {
    return (
      <div className="shared-trip" role="status" aria-live="polite">
        <p className="shared-trip__notice">読み込み中…</p>
      </div>
    );
  }

  if (state.status === "ended") {
    return (
      <div className="shared-trip">
        <div className="shared-trip__notice-card">
          <h1>共有は終了しました</h1>
          <p>このリンクはもう使われていません。共有した人にもう一度リンクを聞いてください。</p>
        </div>
      </div>
    );
  }

  if (state.status === "error" || !data) {
    return (
      <div className="shared-trip">
        <div className="shared-trip__notice-card">
          <h1>読み込めませんでした</h1>
          <p>通信が届いていないようです。しばらくしてから開き直してください。</p>
        </div>
      </div>
    );
  }

  const { trip } = data;

  return (
    <div className="shared-trip">
      <header className="shared-trip__hero">
        <p className="shared-trip__eyebrow">旅行のしおり</p>
        <h1>{trip.name}</h1>
        <p className="shared-trip__meta">
          {trip.destination && <span>{trip.destination}</span>}
          <span>
            {formatDisplayDate(trip.startDate)} 〜 {formatDisplayDate(trip.endDate)}
          </span>
          <span>{tripDurationLabel(trip.startDate, trip.endDate)}</span>
        </p>
      </header>

      <main className="shared-trip__body">
        {trip.memo && (
          <Card className="mb-4">
            <p className="text-xs text-slate-400">メモ</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{trip.memo}</p>
          </Card>
        )}

        <section className="shared-trip__section">
          <h2>日程</h2>
          {data.schedule.length === 0 ? (
            <p className="shared-trip__empty">日程はまだ入っていません。</p>
          ) : (
            <div className="flex flex-col gap-3">
              {scheduleByDay.map(({ date, items }) => (
                <Card key={date}>
                  <p className="text-sm font-semibold text-slate-700">{formatDisplayDate(date)}</p>
                  {items.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">予定なし</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {items.map((item, index) => {
                        const type = getTripScheduleType(item.type as TripScheduleType);
                        return (
                          <li key={`${date}-${index}`} className="flex gap-3">
                            <span className="w-20 shrink-0 text-xs text-slate-500">
                              {item.startTime ? `${item.startTime}${item.endTime ? `〜${item.endTime}` : ""}` : "終日"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-slate-700">{item.title}</span>
                                <Badge tone={type.tone}>{type.label}</Badge>
                              </span>
                              {item.location && (
                                <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                                  <MapPin size={12} />
                                  {item.location}
                                </span>
                              )}
                              {item.memo && (
                                <span className="mt-0.5 block whitespace-pre-wrap text-xs text-slate-500">
                                  {item.memo}
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {data.includeExpenses && (
          <section className="shared-trip__section">
            <h2>費用</h2>
            {data.expenses.length === 0 ? (
              <p className="shared-trip__empty">費用はまだ入っていません。</p>
            ) : (
              <Card>
                <p className="text-sm font-semibold text-slate-700">合計 ¥{expenseTotal.toLocaleString()}</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {data.expenses.map((expense, index) => {
                    const category = getTripExpenseCategory(expense.category as TripExpenseCategory);
                    return (
                      <li key={index} className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-700">{expense.title}</span>
                            <Badge tone={category.tone}>{category.label}</Badge>
                            {!expense.paid && <Badge tone="warning">未払い</Badge>}
                          </span>
                          {expense.memo && (
                            <span className="mt-0.5 block whitespace-pre-wrap text-xs text-slate-500">
                              {expense.memo}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm text-slate-700">¥{expense.amount.toLocaleString()}</span>
                          {expense.currency && expense.originalAmount !== undefined && (
                            <span className="block text-xs text-slate-400">
                              {formatOriginalAmount(expense.originalAmount, expense.currency)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </section>
        )}

        <section className="shared-trip__section">
          <h2>持ち物</h2>
          {data.packing.length === 0 ? (
            <p className="shared-trip__empty">持ち物はまだ入っていません。</p>
          ) : (
            <Card>
              <ul className="flex flex-col gap-2">
                {data.packing.map((item, index) => {
                  const category = getTripPackingCategory(item.category as TripPackingCategory);
                  return (
                    <li key={index} className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${item.checked ? "text-slate-400 line-through" : "text-slate-700"}`}>
                        {item.title}
                      </span>
                      <Badge tone={category.tone}>{category.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>

        <section className="shared-trip__section">
          <h2>ルート</h2>
          {data.route.length === 0 ? (
            <p className="shared-trip__empty">行きたい場所はまだ入っていません。</p>
          ) : (
            <Card>
              <ol className="flex flex-col gap-2">
                {data.route.map((place, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="shrink-0 text-xs text-slate-400">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-700">{place.name}</span>
                        {place.date && <Badge>{formatDisplayDate(place.date)}</Badge>}
                        {place.visited && <Badge tone="success">行った</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{place.address}</span>
                      {place.memo && (
                        <span className="mt-0.5 block whitespace-pre-wrap text-xs text-slate-500">{place.memo}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </section>
      </main>

      <footer className="shared-trip__footer">
        <p>LIFE HUB で作られた旅行のしおりです。閲覧専用で、内容は変更できません。</p>
      </footer>
    </div>
  );
}
