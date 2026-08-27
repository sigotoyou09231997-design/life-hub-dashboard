import { useEffect, useRef, useState } from "react";
import { MapPin, StickyNote } from "lucide-react";
import { db } from "../../db/schema";
import type { TripRoutePlace } from "../../types";
import { buildMapEmbedUrl } from "../../lib/googleMaps";
import { formatShortDate } from "../../lib/date";
import { Input, Textarea } from "../ui/Input";
import { Field } from "../ui/Field";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  tripId: string;
  initial?: TripRoutePlace;
  /** 追加時に末尾へ置くための順番。編集時は初期値をそのまま使う。 */
  nextSortOrder: number;
  /** 日程の場所からルートに起こすときに、入力欄を埋めておく値。名前は予定の
   * タイトル(「朝市」)、住所はその予定の場所(「函館市若松町9-19」)。 */
  preset?: { name: string; address: string };
  /** 旅行の全日程(YYYY-MM-DD)。「何日目に回るか」の選択肢に使う。1日だけの旅行や
   * 日程が入っていない旅行では選ばせない。 */
  dayList: string[];
  /** 1件も無いときにルートタブへ直接置く形。戻る先が無いので「キャンセル」は出さず、
   * 面の見出しも「どこへ行きたいか」ではなく最初の一歩として書き換える。 */
  inline?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

/** 住所を打ち終わるのを待つ長さ。1文字ごとに地図を読み直すと、入力中ずっと
 *  読み込みが走って手元が重くなる。 */
const PREVIEW_DEBOUNCE_MS = 600;

export function TripRouteForm({ tripId, initial, nextSortOrder, preset, dayList, inline = false, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? preset?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? preset?.address ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  /** 何日目に回るか。決めていない場所も普通にあるので、空(未定)を既定にする。 */
  const [date, setDate] = useState(initial?.date ?? "");
  const [saving, setSaving] = useState(false);

  // 入力が止まってから地図に渡す文字列。初期値ぶんは最初から出しておく
  // (編集で開いたのに地図が空、という間を作らない)。
  const [previewQuery, setPreviewQuery] = useState(initial?.address ?? preset?.address ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPreviewQuery(address.trim()), PREVIEW_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [address]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;

    setSaving(true);
    const record: TripRoutePlace = {
      tripId,
      name: name.trim(),
      address: address.trim(),
      sortOrder: initial?.sortOrder ?? nextSortOrder,
      date: date || undefined,
      memo: memo || undefined,
      visited: initial?.visited ?? false,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    if (initial?.id) {
      await db.tripRoutePlaces.update(initial.id, record);
    } else {
      await db.tripRoutePlaces.add(record);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption={inline ? "最初の行きたい場所" : "どこへ行きたいか"} icon={MapPin}>
        <Input
          label="場所の名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 五稜郭"
          required
          autoFocus
        />
        <Input
          label="住所・場所"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="例: 北海道函館市五稜郭町44"
          hint="入力すると下の地図がその場所に動きます。施設名だけでも構いません。"
          required
        />
        <div className="trip-route-preview">
          {previewQuery ? (
            <iframe
              key={previewQuery}
              title="入力した場所の地図"
              src={buildMapEmbedUrl(previewQuery)}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <p>住所を入れると、ここに地図が出ます</p>
          )}
        </div>
      </FormPanel>

      <FormPanel caption="そのほか" icon={StickyNote}>
        {dayList.length > 1 && (
          // 見出しと余白は、下の「メモ」など他の項目と同じ Field に任せる。ここだけ
          // 素の div で組んでいたため、面の左上に文字が貼り付いていた。
          <Field label="何日目に回るか" optional as="div">
            <div className="trip-day-pick__chips" role="group" aria-label="何日目に回るか">
              <button
                type="button"
                className={`trip-day-pick__chip${date === "" ? " is-active" : ""}`}
                aria-pressed={date === ""}
                onClick={() => setDate("")}
              >
                決めていない
              </button>
              {dayList.map((option, i) => (
                <button
                  key={option}
                  type="button"
                  className={`trip-day-pick__chip${date === option ? " is-active" : ""}`}
                  aria-pressed={date === option}
                  onClick={() => setDate(option)}
                >
                  {i + 1}日目 {formatShortDate(option)}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Textarea
          label="メモ"
          optional
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          placeholder="営業時間、予約の有無など"
        />
      </FormPanel>

      {/* FormActions はシートの底に貼りつく作りなので、シートの外(ルートタブに直接
          置く形)では使わない — 画面下端に貼りついて入力欄の上に重なってしまう。 */}
      {inline ? (
        <Button type="submit" disabled={saving} className="w-full">
          ルートに追加
        </Button>
      ) : (
        <FormActions>
          <Button type="button" variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="submit" disabled={saving}>
            {initial ? "変更を保存" : "ルートに追加"}
          </Button>
        </FormActions>
      )}
    </form>
  );
}
