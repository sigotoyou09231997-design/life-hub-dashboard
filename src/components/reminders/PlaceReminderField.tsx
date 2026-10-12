import { useState } from "react";
import { MapPin, Search } from "lucide-react";
import { placeSubtitle, searchPlaces, type GeocodedPlace } from "../../lib/geocoding";
import {
  RADIUS_OPTIONS,
  describePlaceReminder,
  radiusLabel,
  type PlaceReminderDraft,
} from "../../lib/placeReminders";
import type { PlaceReminderTrigger } from "../../types";
import { Input } from "../ui/Input";
import { Field } from "../ui/Field";
import { SwitchField } from "../ui/SwitchField";
import { SegmentedField } from "../ui/SegmentedField";
import { Button } from "../ui/Button";

interface Props {
  value: PlaceReminderDraft;
  onChange: (draft: PlaceReminderDraft) => void;
}

const TRIGGER_OPTIONS = [
  { value: "enter" as PlaceReminderTrigger, label: "着いたら" },
  { value: "leave" as PlaceReminderTrigger, label: "離れたら" },
];

/** 距離の選択肢。保存する値は今までのプルダウンと同じメートルの数で、ボタンの値は文字列にして持つ
 * (SegmentedField が文字列で受け渡すため)。 */
const RADIUS_BUTTONS = RADIUS_OPTIONS.map((meters) => ({ value: String(meters), label: radiusLabel(meters) }));

/**
 * タスク・メモに付ける「場所で知らせる」の設定。
 *
 * 場所の決め方は2つ置いてある。今その場にいるなら現在地をそのまま覚えられるし、
 * 家で先に仕込むなら地名で探せる(src/lib/geocoding.ts)。地名検索の元は GeoNames
 * なので、駅や地区までは出るが店の番地までは出ない — 半径が最小100mなのはそのため。
 *
 * **アプリを開いている間しか判定できない**ことは、隠さずここに書いておく。
 * 「閉じていても鳴る」と思って使われると、いちばん肝心な時に鳴らないため。
 */
export function PlaceReminderField({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodedPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");

  function patch(next: Partial<PlaceReminderDraft>) {
    onChange({ ...value, ...next });
  }

  function useCurrentPosition() {
    if (!navigator.geolocation) {
      setLocateError("この端末では現在地を取得できません。");
      return;
    }
    setLocating(true);
    setLocateError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        patch({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          // 名前がまだ空のときだけ、仮の名前を入れておく(通知に何か出るように)。
          label: value.label.trim() || "今いる場所",
        });
        setLocating(false);
      },
      () => {
        setLocateError("現在地を取得できませんでした。位置情報を許可すると使えます。");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setResults(await searchPlaces(query));
    setSearching(false);
  }

  function pick(place: GeocodedPlace) {
    patch({
      latitude: place.latitude,
      longitude: place.longitude,
      label: place.name || query.trim(),
    });
    setResults(null);
    setQuery("");
  }

  const hasPlace = value.latitude != null && value.longitude != null;
  // 一覧に無い距離(ほかの経路で入った値)のときは、末尾に1つ足して選んだ状態で見せる。足さないと、
  // どれも選ばれていない見た目のまま、保存では元の値が残って分かりにくい。下書きは開いた後に
  // 読み込まれる(src/lib/placeReminders.ts)ので、ここは今の値で決める。
  const radiusButtons = RADIUS_OPTIONS.some((meters) => meters === value.radiusMeters)
    ? RADIUS_BUTTONS
    : [...RADIUS_BUTTONS, { value: String(value.radiusMeters), label: radiusLabel(value.radiusMeters) }];

  return (
    <>
      <SwitchField
        label="場所で知らせる"
        hint="アプリを開いている間だけ判定します。閉じている間は鳴りません。"
        checked={value.enabled}
        onChange={(enabled) => patch({ enabled })}
      />

      {value.enabled && (
        <>
          <Field
            as="div"
            label="場所"
            hint={
              hasPlace
                ? describePlaceReminder({
                    label: value.label.trim() || "この場所",
                    trigger: value.trigger,
                    radiusMeters: value.radiusMeters,
                  }) + "、通知します。"
                : "今いる場所を覚えるか、地名で探して決めます。"
            }
          >
            <div className="place-reminder__actions">
              <Button type="button" variant="secondary" onClick={useCurrentPosition} disabled={locating}>
                <MapPin size={16} />
                {locating ? "確認中…" : "今いる場所にする"}
              </Button>
              {hasPlace && (
                <span className="place-reminder__coords">
                  {value.latitude!.toFixed(4)}, {value.longitude!.toFixed(4)}
                </span>
              )}
            </div>

            <div className="place-reminder__search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder="地名で探す(例: 東京駅)"
                className="field-shell min-w-0 flex-1"
              />
              <Button type="button" variant="secondary" onClick={() => void runSearch()} disabled={searching}>
                <Search size={16} />
                {searching ? "検索中…" : "探す"}
              </Button>
            </div>

            {results !== null &&
              (results.length === 0 ? (
                <p className="place-reminder__empty">見つかりませんでした。近くの駅や地区の名前でも探せます。</p>
              ) : (
                <ul className="place-reminder__results">
                  {results.map((place) => (
                    <li key={`${place.latitude},${place.longitude}`}>
                      <button type="button" onClick={() => pick(place)}>
                        <strong>{place.name}</strong>
                        <span>{placeSubtitle(place)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}

            {locateError && <p className="place-reminder__error">{locateError}</p>}
          </Field>

          <Input
            label="場所の名前"
            value={value.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder="例: 東京駅"
            hint="通知に出る名前です。"
          />

          {/* プルダウンにしない。この欄はタスク・買い物リストのシートの中にあり、iPhone ではシートの中の
              プルダウンを押すとキーボードが閉じてシートが動き、選択肢が欄から離れた所に出て、押したつもりが
              外れる(2026-10-12。2026-10-11の持ち物と同じ直し方)。4つなら1段に収まる。 */}
          <SegmentedField
            label="この距離まで近づいたら"
            value={String(value.radiusMeters)}
            options={radiusButtons}
            onChange={(meters) => patch({ radiusMeters: Number(meters) })}
            columns={4}
            separate
          />

          <SegmentedField
            label="いつ知らせる"
            value={value.trigger}
            options={TRIGGER_OPTIONS}
            onChange={(trigger) => patch({ trigger })}
          />
        </>
      )}
    </>
  );
}
