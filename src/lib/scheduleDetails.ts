import type { TripScheduleItem } from "../types";

/**
 * 旅行の予定の詳細(住所・電話番号・URL・営業時間・チェックイン/アウト。supabase/sql/030)。
 * 2026-10-11、要望の受信箱「予定のところに住所、電話番号、URL、営業時間、ホテルならチェックイン・
 * チェックアウト時間が入ってると便利」から。
 */
export type ScheduleDetailField = "address" | "phone" | "url" | "openingHours" | "checkInTime" | "checkOutTime";

export function hasScheduleDetails(item: Partial<Pick<TripScheduleItem, ScheduleDetailField>> | undefined): boolean {
  if (!item) return false;
  return Boolean(item.address || item.phone || item.url || item.openingHours || item.checkInTime || item.checkOutTime);
}

/** URL の頭に http(s):// が無ければ https:// を付ける(「example.com」と打っても開けるように)。空は空。 */
export function normalizeUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  return /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`;
}

/** 電話をかけるリンク(tel:)。数字・+・#・* だけを残す。かけられる番号が無ければ undefined。 */
export function telHref(phone: string | undefined): string | undefined {
  const digits = (phone ?? "").normalize("NFKC").replace(/[^\d+#*]/g, "");
  return digits.length >= 3 ? `tel:${digits}` : undefined;
}

/** URL を一覧に出す時の短い形(「www.example.com」)。読めない URL はそのまま。 */
export function urlLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** 入力の欄の値を、保存する形にそろえる(空は undefined。チェックイン/アウトは宿泊の時だけ)。 */
export function detailsForSave(
  type: TripScheduleItem["type"],
  values: Record<ScheduleDetailField, string>,
): Pick<TripScheduleItem, ScheduleDetailField> {
  const text = (value: string) => value.trim() || undefined;
  const lodging = type === "lodging";
  return {
    address: text(values.address),
    phone: text(values.phone),
    url: normalizeUrl(values.url),
    openingHours: text(values.openingHours),
    checkInTime: lodging ? text(values.checkInTime) : undefined,
    checkOutTime: lodging ? text(values.checkOutTime) : undefined,
  };
}
