import { useEffect, useState } from "react";
import { MapPin, PenLine, Smile } from "lucide-react";
import { db } from "../../db/schema";
import type { DiaryEntry, DiaryMood } from "../../types";
import { todayStr } from "../../lib/date";
import { buildMapEmbedUrl, coordsQuery } from "../../lib/googleMaps";
import { Input, Textarea } from "../ui/Input";
import { SegmentedField } from "../ui/SegmentedField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  initial?: DiaryEntry;
  /** どの旅行の日か。旅行の詳細から書くときだけ決まっていて、
   * 旅行に紐付かない日記(メモ・リストの日記タブ)では渡さない。 */
  tripId?: string;
  /** 既定日(旅行の期間内)。 */
  defaultDate?: string;
  onSaved: () => void;
  onCancel: () => void;
}

const MOOD_OPTIONS = [
  { value: "good" as DiaryMood, label: "よかった" },
  { value: "normal" as DiaryMood, label: "ふつう" },
  { value: "bad" as DiaryMood, label: "わるい" },
];

interface Spot {
  latitude: number;
  longitude: number;
}

export function DiaryForm({ initial, tripId, defaultDate, onSaved, onCancel }: Props) {
  const [date, setDate] = useState(initial?.date ?? defaultDate ?? todayStr());
  const [body, setBody] = useState(initial?.body ?? "");
  const [mood, setMood] = useState<DiaryMood>(initial?.mood ?? "normal");
  const [placeLabel, setPlaceLabel] = useState(initial?.placeLabel ?? "");
  const [spot, setSpot] = useState<Spot | null>(
    initial?.latitude != null && initial?.longitude != null
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [spotState, setSpotState] = useState<"idle" | "asking" | "denied">("idle");
  const [saving, setSaving] = useState(false);

  function locate() {
    if (!navigator.geolocation) {
      setSpotState("denied");
      return;
    }
    setSpotState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSpot({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setSpotState("idle");
      },
      () => setSpotState("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  // 新しく書き始めたときは、押させずに現在地を取りにいく。あとから「外す」で
  // 落とせるので、要らない日は捨てればいい。書いたあとの編集では取り直さない
  // (あとで開いただけで、書いた場所が今いる場所に書き換わってしまう)。
  const isNew = !initial;
  useEffect(() => {
    if (isNew) locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setSaving(true);
    const record: DiaryEntry = {
      date,
      // 旅行から書いたものだけ旅行に紐付ける。編集時は元の紐付きをそのまま残す —
      // 旅行の日記を旅行外の一覧から開いて直しても、旅行から外れないようにする。
      tripId: tripId ?? initial?.tripId,
      body: body.trim(),
      mood,
      latitude: spot?.latitude,
      longitude: spot?.longitude,
      placeLabel: spot && placeLabel.trim() ? placeLabel.trim() : undefined,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.diaryEntries.update(initial.id, record);
    } else {
      await db.diaryEntries.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="今日のこと" icon={PenLine}>
        <DateField label="日付" value={date} onChange={setDate} />
        <Textarea
          label="本文"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="あったこと、思ったことなど"
          required
          autoFocus
        />
      </FormPanel>

      <FormPanel caption="気分" icon={Smile}>
        <SegmentedField label="今日はどうだった?" value={mood} options={MOOD_OPTIONS} onChange={setMood} />
      </FormPanel>

      <FormPanel caption="場所" icon={MapPin}>
        {spot ? (
          <>
            <div className="diary-form__map">
              <iframe
                key={`${spot.latitude},${spot.longitude}`}
                title="現在地の地図"
                src={buildMapEmbedUrl(coordsQuery(spot.latitude, spot.longitude))}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            <Input
              label="場所の名前"
              optional
              value={placeLabel}
              onChange={(e) => setPlaceLabel(e.target.value)}
              placeholder="例: 鎌倉の宿"
              hint="緯度経度から地名は出せないので、残したいときは自分で付けます。"
            />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setSpot(null)}>
                場所を外す
              </Button>
              <Button type="button" variant="secondary" onClick={locate} disabled={spotState === "asking"}>
                {spotState === "asking" ? "確認中…" : "現在地に更新"}
              </Button>
            </div>
          </>
        ) : (
          <div className="diary-form__spot-empty">
            <p>
              {spotState === "asking"
                ? "現在地を確認しています…"
                : spotState === "denied"
                  ? "現在地を取得できませんでした。位置情報を許可すると記録できます。"
                  : "この日記に場所は付いていません。"}
            </p>
            <Button type="button" variant="secondary" onClick={locate} disabled={spotState === "asking"}>
              現在地を記録
            </Button>
          </div>
        )}
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? "変更を保存" : "日記を書く"}
        </Button>
      </FormActions>
    </form>
  );
}
