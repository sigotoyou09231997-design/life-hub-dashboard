import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/min";
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

/**
 * 電話番号に、区切りのハイフンを入れる(「0886870613」→「088-687-0613」)。
 *
 * iPhone の電話用のテンキー(電話番号の欄は type="tel")にはハイフンのキーが無く、打てなかった
 * (2026-10-12、本人経由の報告)。テンキーは数字が速く打てるのでそのままにして、打ち終わったら
 * こちらで入れる。日本の固定電話は市外局番の長さがまちまちなので、区切る位置は電話番号の定番の
 * 部品(libphonenumber-js)の日本の決まりに任せる。番号として読めない時・内線や「(代表)」のような
 * 言葉が混ざっている時は、打ったままにする。
 */
export function formatPhone(raw: string): string {
  const value = raw.normalize("NFKC").trim();
  if (!value) return "";
  if (/[^\d\s\-+()]/.test(value)) return raw.trim();
  const parsed = parsePhoneNumberFromString(value, "JP");
  if (!parsed || !parsed.isPossible()) return raw.trim();
  // 日本の番号は国内の書き方(+81 で打っても 088-687-0613)。海外の番号は +1 415 … の形。
  return parsed.country === "JP" ? parsed.formatNational() : parsed.formatInternational();
}

/**
 * 電話番号を打っている途中で、ハイフンを入れていく(「0886」→「088-6」、「0886870613」→「088-687-0613」)。
 *
 * 欄を離れた時だけ整える(formatPhone)と、打っている間は何も変わらず、直ったのか分からなかった
 * (2026-10-12、「変わってないらしい」)。数字を足した時だけ整え、消している時は触らない — 消した
 * ハイフンが勝手に戻ると、消せなくなるため。数字・ハイフン・空白・+・かっこ以外(内線などの言葉)が
 * 混ざっている時も触らない(整える部品は、言葉の部分を落としてしまうため)。
 */
export function formatPhoneTyping(next: string, previous: string): string {
  if (next.length <= previous.length) return next;
  const value = next.normalize("NFKC");
  if (/[^\d\s\-+()]/.test(value)) return next;
  return new AsYouType("JP").input(value);
}

/** 一覧・共有のしおりに出す電話番号。保存してある形がハイフン無しでも、ハイフン付きで見せる(かける番号は変えない)。 */
export function phoneLabel(phone: string): string {
  return formatPhone(phone) || phone;
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
    phone: text(formatPhone(values.phone)),
    url: normalizeUrl(values.url),
    openingHours: text(values.openingHours),
    checkInTime: lodging ? text(values.checkInTime) : undefined,
    checkOutTime: lodging ? text(values.checkOutTime) : undefined,
  };
}
