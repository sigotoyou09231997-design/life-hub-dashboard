/**
 * 場所をきっかけにしたリマインド(types/index.ts の PlaceReminder)の判定。
 *
 * **アプリを開いている間だけ動く。** ブラウザ・PWAには地点監視(Geofencing)の仕組みが
 * 無いので、「閉じている間に駅に着いたら鳴る」は作れない。ここが見るのは、アプリを
 * 開いた時と、開いている間の定期的な現在地だけ。2026-09-04に本人がこの範囲で了解済み。
 *
 * 判定そのものはここに置いて、位置を取る・通知を出す側(usePlaceReminderWatch)からは
 * 切り離してある — 位置情報のふりをさせずにテストできるようにするため。
 */

import { db } from "../db/schema";
import type { PlaceReminder, PlaceReminderOwnerType, PlaceReminderTrigger } from "../types";

/** 半径の選択肢(m)。GPSは街中で数十m平気でずれるので、100mより細かくは刻まない。 */
export const RADIUS_OPTIONS = [100, 200, 500, 1000] as const;

export const DEFAULT_RADIUS_METERS = 200;

/**
 * 一度鳴らしたら、この間は同じリマインドで鳴らさない。
 *
 * GPSの揺れで範囲の境目を出たり入ったりすると、そのたびに鳴ってしまう。
 * 「駅に着いた」は30分に何度も起きることではないので、まとめて1回にする。
 */
export const RENOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * 作ってから、この間は「初めて見たときにもう範囲の中にいた」でも鳴らさない。
 *
 * その場に立って設定した直後に鳴るのを避けるため。逆に、家で設定してから
 * アプリを閉じたまま移動して現地で開いた場合は、この時間を過ぎているので鳴る
 * (前回の記録が無いことを理由に取りこぼすと、この機能の一番の使い道が抜ける)。
 */
export const SETTLE_AFTER_CREATE_MS = 10 * 60 * 1000;

export const TRIGGER_LABELS: Record<PlaceReminderTrigger, string> = {
  enter: "着いたら",
  leave: "離れたら",
};

export interface Coords {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** 2点間の距離(m)。地球を球とみなすhaversine — 数kmの範囲では十分な精度。 */
export function distanceMeters(a: Coords, b: Coords): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInsideRadius(reminder: PlaceReminder, position: Coords): boolean {
  return distanceMeters({ latitude: reminder.latitude, longitude: reminder.longitude }, position) <= reminder.radiusMeters;
}

/** 1件ぶんの判定結果。 */
export interface PlaceReminderCheck {
  reminder: PlaceReminder;
  /** いま範囲の中にいるか。次回の見比べのために必ず書き戻す。 */
  inside: boolean;
  /** 今回このリマインドを知らせるか。 */
  fired: boolean;
}

/**
 * 現在地を1回見て、どのリマインドが鳴るかを決める。
 *
 * 鳴る条件は「前回と今回で範囲の内外が変わり、その向きが設定と合っていること」。
 * 前回の記録が無い場合だけは例外で、作ってから SETTLE_AFTER_CREATE_MS を過ぎていれば
 * 「もう中にいる」ことを到着とみなす(上のコメント参照)。
 */
export function checkPlaceReminders(
  reminders: PlaceReminder[],
  position: Coords,
  now: number = Date.now(),
): PlaceReminderCheck[] {
  return reminders.map((reminder) => {
    const inside = isInsideRadius(reminder, position);
    const previous = reminder.inside;

    let fired: boolean;
    if (previous === undefined) {
      fired = inside && reminder.trigger === "enter" && now - reminder.createdAt >= SETTLE_AFTER_CREATE_MS;
    } else if (previous === inside) {
      // 内外が変わっていない。留まっている間ずっと鳴らすものではない。
      fired = false;
    } else {
      fired = inside ? reminder.trigger === "enter" : reminder.trigger === "leave";
    }

    if (fired && reminder.lastNotifiedAt != null && now - reminder.lastNotifiedAt < RENOTIFY_COOLDOWN_MS) {
      fired = false;
    }

    return { reminder, inside, fired };
  });
}

/** 「東京駅に着いたら」。通知の本文と、フォームの下の説明の両方で使う。 */
export function describePlaceReminder(reminder: Pick<PlaceReminder, "label" | "trigger" | "radiusMeters">): string {
  const distance = reminder.radiusMeters >= 1000 ? `${reminder.radiusMeters / 1000}km` : `${reminder.radiusMeters}m`;
  return `${reminder.label}(半径${distance})に${TRIGGER_LABELS[reminder.trigger]}`;
}

/** 半径の選択肢の表示名。 */
export function radiusLabel(meters: number): string {
  return meters >= 1000 ? `${meters / 1000}km` : `${meters}m`;
}

/* --- フォームとの受け渡し ---------------------------------------------------
   写真(src/lib/attachments.ts)と同じ考え方。新しく作るタスク・メモにはまだidが無く、
   リマインドの貼り先を決められないので、フォームの中では下書きとして持ち、
   本体を保存して得たidに向けて後から書く。 */

export interface PlaceReminderDraft {
  enabled: boolean;
  label: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  trigger: PlaceReminderTrigger;
}

export const EMPTY_PLACE_REMINDER_DRAFT: PlaceReminderDraft = {
  enabled: false,
  label: "",
  latitude: null,
  longitude: null,
  radiusMeters: DEFAULT_RADIUS_METERS,
  trigger: "enter",
};

/** 下書きが実際に保存できる形になっているか(場所と名前が揃っているか)。 */
export function isPlaceReminderDraftComplete(draft: PlaceReminderDraft): boolean {
  return draft.enabled && draft.latitude != null && draft.longitude != null && draft.label.trim().length > 0;
}

export async function loadPlaceReminderDraft(
  ownerType: PlaceReminderOwnerType,
  ownerId: string,
): Promise<PlaceReminderDraft> {
  const existing = await db.placeReminders.where("[ownerType+ownerId]").equals([ownerType, ownerId]).first();
  if (!existing) return EMPTY_PLACE_REMINDER_DRAFT;
  return {
    enabled: true,
    label: existing.label,
    latitude: existing.latitude,
    longitude: existing.longitude,
    radiusMeters: existing.radiusMeters,
    trigger: existing.trigger,
  };
}

/**
 * 下書きを書き戻す。1つの相手につきリマインドは1件だけ持つ。
 *
 * 場所・半径・向きのどれかが変わったら、覚えていた内外(inside)と最後に知らせた時刻を
 * 捨てる — 別の場所に付け替えたのに、前の場所での「もう中にいる」を引き継ぐと、
 * 最初の1回の判定がまるごとおかしくなる。
 */
export async function savePlaceReminderDraft(
  ownerType: PlaceReminderOwnerType,
  ownerId: string,
  draft: PlaceReminderDraft,
): Promise<void> {
  const existing = await db.placeReminders.where("[ownerType+ownerId]").equals([ownerType, ownerId]).first();

  if (!isPlaceReminderDraftComplete(draft)) {
    if (existing?.id) await db.placeReminders.delete(existing.id);
    return;
  }

  const next = {
    ownerType,
    ownerId,
    label: draft.label.trim(),
    latitude: draft.latitude!,
    longitude: draft.longitude!,
    radiusMeters: draft.radiusMeters,
    trigger: draft.trigger,
  };

  if (!existing?.id) {
    await db.placeReminders.add({ ...next, createdAt: Date.now() });
    return;
  }

  const moved =
    existing.latitude !== next.latitude ||
    existing.longitude !== next.longitude ||
    existing.radiusMeters !== next.radiusMeters ||
    existing.trigger !== next.trigger;

  await db.placeReminders.update(existing.id, {
    ...next,
    ...(moved ? { inside: undefined, lastNotifiedAt: undefined } : {}),
  });
}

/** タスク・メモを消したときに、付いていたリマインドも一緒に落とす。 */
export async function deletePlaceRemindersFor(ownerType: PlaceReminderOwnerType, ownerId: string): Promise<void> {
  await db.placeReminders.where("[ownerType+ownerId]").equals([ownerType, ownerId]).delete();
}
