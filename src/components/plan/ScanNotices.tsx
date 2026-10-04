import { TriangleAlert } from "lucide-react";

/** 写真・文章の読み取りで、全部は読めなかった時の断り(src/lib/tripPlanScan.ts の
 * TripPlanScanResult.notices)。日程の一覧の上に出す。
 *
 * 一部の日が抜けていることに気付かないまま、読み取れた分だけを信じて動くと困るので、
 * 一覧が出ている時こそ目立つ場所に置く。 */
export function ScanNotices({ notices }: { notices: string[] }) {
  if (notices.length === 0) return null;
  return (
    <div role="alert" className="glass-row space-y-1.5 rounded-xl p-3">
      {notices.map((notice) => (
        <p key={notice} className="flex items-start gap-1.5 text-xs leading-relaxed text-warning">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {notice}
        </p>
      ))}
    </div>
  );
}
