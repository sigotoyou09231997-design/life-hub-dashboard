import { useMemo } from "react";
import { Download } from "lucide-react";
import type { Trip, TripScheduleItem } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { buildTripMyMapsCsv, tripMyMapsFilename } from "../../lib/tripMyMapsCsv";
import { downloadTransactionCsv } from "../../lib/transactionCsv";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface Props {
  trip: Trip;
  schedule: TripScheduleItem[];
  onClose: () => void;
}

/**
 * 日程を Google マイマップへ取り込むための CSV を書き出すシート。
 *
 * マイマップには外から書き込む手段が無いので、こちらでできるのはファイルを渡す
 * ところまで(CSVの作りは src/lib/tripMyMapsCsv.ts)。場所が空の日程は地図に置けないので、
 * 黙って落とさず、どれが載らないかをここに並べる。
 */
export function TripMyMapsSheet({ trip, schedule, onClose }: Props) {
  const showToast = useToast();
  const { csv, placed, skipped } = useMemo(() => buildTripMyMapsCsv(trip, schedule), [trip, schedule]);

  function handleDownload() {
    downloadTransactionCsv(csv, tripMyMapsFilename(trip.name));
    showToast("CSVを書き出しました");
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        「{trip.name}」の日程を、Googleマイマップに取り込める CSV にします。場所の入っている日程が{" "}
        <span className="font-semibold text-slate-800">{placed}件</span> 載ります。
      </p>

      {skipped.length > 0 && (
        <div className="rounded-xl bg-amber-50/70 p-3">
          <p className="text-sm font-medium text-slate-700">場所が空のため載せられない日程（{skipped.length}件）</p>
          <ul className="mt-1.5 space-y-0.5 text-sm text-slate-600">
            {skipped.map((item) => (
              <li key={item.id}>
                {formatDisplayDate(item.date)} {item.title}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            日程の編集で「場所」に住所や施設名を入れてから書き出すと、地図に載ります。
          </p>
        </div>
      )}

      <Button disabled={placed === 0} onClick={handleDownload}>
        <Download size={16} />
        CSVを書き出す
      </Button>

      <div className="text-sm text-slate-600">
        <p className="font-medium text-slate-700">マイマップへの入れ方（パソコンのブラウザで）</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          <li>入れたい地図をマイマップで開く</li>
          <li>左の「レイヤを追加」を押し、できたレイヤの「インポート」から、書き出した CSV を選ぶ</li>
          <li>場所の列は「場所」、マーカーの名前の列は「名前」を選ぶ</li>
          <li>取り込んだあと、レイヤのスタイル設定で「日目」の列を選ぶと、日ごとに色分けできる</li>
        </ol>
        <p className="mt-2 text-xs text-slate-400">
          1つの地図に置けるレイヤーは10枚までです。地名があいまいだと別の場所に置かれることがあるので、取り込み後に地図で確かめてください。
        </p>
      </div>
    </div>
  );
}
