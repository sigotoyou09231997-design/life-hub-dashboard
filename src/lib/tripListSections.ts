import type { Trip } from "../types";

/**
 * 旅行一覧(src/pages/TripsPage.tsx)の並び。以前は「旅行中 / 計画中 / 完了済み」を同じ幅の3列に流していたが、
 * 3列に割るとカードが小さくなって写真が主役になれず、旅行中が1件しか無いと
 * その列だけが空のまま伸びていた。代わりに1件だけを大きく先頭に立てる:
 *
 *   lead     いま行っている旅行。無ければ、次に出発する旅行。
 *   upcoming これから行く残り。近い順。
 *   past     過去の旅行。新しい順。
 *
 * 過去かどうかは「完了」の印だけでなく、最終日が過ぎたかでも決める(2026-10-12)。旅行から帰って
 * 「完了」に直す人は少なく、印だけで分けていた頃は、終わった旅行が「次の旅行」として先頭に残り続けた。
 * 同じ理由で、出発日を過ぎてまだ終わっていない旅行は、印が「計画中」のままでも旅行中として先頭に来る
 * (出発日の順に並べれば、そうなる)。
 *
 * これから行く旅行が無い時は、終わった旅行を先頭に立てず、「次の旅行を計画する」入り口を置く
 * (TripNewCard)。以前は最後の旅行を大きく出していて、終わった旅行に「次の旅行」と付いていた。
 */
export function splitTrips(trips: Trip[], today: string) {
  const isPast = (trip: Trip) => trip.status === "completed" || trip.endDate < today;
  const current = trips
    .filter((trip) => !isPast(trip))
    .sort(
      (a, b) =>
        Number(b.status === "ongoing") - Number(a.status === "ongoing") || a.startDate.localeCompare(b.startDate),
    );
  const past = trips.filter(isPast).sort((a, b) => b.endDate.localeCompare(a.endDate));

  return { lead: current[0] ?? null, upcoming: current.slice(1), past };
}
