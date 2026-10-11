import { useMemo } from "react";
import { Download } from "lucide-react";
import type { Trip, TripScheduleItem } from "../../types";
import { formatDisplayDate } from "../../lib/date";
import { buildTripMyMapsCsv, buildTripMyMapsDayFiles, tripMyMapsFilename } from "../../lib/tripMyMapsCsv";
import { downloadTransactionCsv } from "../../lib/transactionCsv";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface Props {
  trip: Trip;
  schedule: TripScheduleItem[];
  onClose: () => void;
}

/** マイマップの1つの地図に置けるレイヤーの数。 */
const MYMAPS_LAYER_LIMIT = 10;

/** 続けて何ファイルも落とすと、ブラウザが先のダウンロードを取りこぼすことがあるので間を空ける。 */
const DOWNLOAD_GAP_MS = 300;

/**
 * 日程を Google マイマップへ取り込むための CSV を書き出すシート。
 *
 * マイマップには外から書き込む手段が無いので、こちらでできるのはファイルを渡す
 * ところまで(CSVの作りは src/lib/tripMyMapsCsv.ts)。場所が空の日程は地図に置けないので、
 * 黙って落とさず、どれが載らないかをここに並べる。
 */
export function TripMyMapsSheet({ trip, schedule, onClose }: Props) {
  const showToast = useToast();
  const whole = useMemo(() => buildTripMyMapsCsv(trip, schedule), [trip, schedule]);
  const { files } = useMemo(() => buildTripMyMapsDayFiles(trip, schedule), [trip, schedule]);
  const { placed, skipped } = whole;

  function handleDownloadWhole() {
    downloadTransactionCsv(whole.csv, tripMyMapsFilename(trip.name));
    showToast("CSVを書き出しました");
    onClose();
  }

  async function handleDownloadByDay() {
    for (const [index, file] of files.entries()) {
      if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, DOWNLOAD_GAP_MS));
      downloadTransactionCsv(file.csv, file.filename);
    }
    showToast(`${files.length}ファイルを書き出しました`);
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

      <div className="flex flex-col gap-2">
        <Button disabled={files.length === 0} onClick={() => void handleDownloadByDay()}>
          <Download size={16} />
          日ごとに分けて書き出す（{files.length}ファイル）
        </Button>
        <p className="text-xs text-slate-500">
          1日ぶんが1枚のレイヤーになります。ブラウザが複数ファイルのダウンロードを聞いてきたら、許可してください。
          {files.length > MYMAPS_LAYER_LIMIT &&
            `${files.length}日あるので、1つの地図に置けるレイヤー（${MYMAPS_LAYER_LIMIT}枚まで）に入り切りません。下の「1つにまとめて」を使ってください。`}
        </p>
        <Button variant="secondary" disabled={placed === 0} onClick={handleDownloadWhole}>
          <Download size={16} />
          1つにまとめて書き出す
        </Button>
        <p className="text-xs text-slate-500">
          全日程が1枚のレイヤーに入ります。取り込んだあと、レイヤのスタイルの「場所のグループ化方法」で「データ列別のスタイル」→「日目」を選ぶと、日ごとに色分けできます。
        </p>
      </div>

      <div className="text-sm text-slate-600">
        <p className="font-medium text-slate-700">マイマップへの入れ方（パソコンのブラウザで）</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-5">
          <li>入れたい地図をマイマップで開く</li>
          <li>左の「レイヤを追加」を押し、できたレイヤの「インポート」から、書き出した CSV を選ぶ（日ごとに分けたときは、ファイルごとにこれを繰り返す）</li>
          <li>「目印を配置する列」の画面では、最初から別の列（「日付」など）にチェックが入っていることがあります。それを外して、「場所」だけにチェックを入れる</li>
          <li>マーカーの名前の列は「名前」を選ぶ</li>
          <li>
            取り込んだレイヤは「均一スタイル」になり、中身が「すべてのアイテム」にまとまって見えます。1件ずつ一覧に出したいときは、レイヤのスタイルのアイコンを押し、「場所のグループ化方法」で「個別スタイル」を選ぶ
          </li>
        </ol>
        <p className="mt-2 text-xs text-slate-400">
          1つの地図に置けるレイヤーは{MYMAPS_LAYER_LIMIT}枚までで、いまその地図にあるレイヤーも数えます。地名があいまいだと別の場所に置かれることがあるので、取り込み後に地図で確かめてください。
        </p>
      </div>
    </div>
  );
}
