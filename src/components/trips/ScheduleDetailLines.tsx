import { BedDouble, Clock, Globe, MapPinHouse, Phone } from "lucide-react";
import { buildMapSearchUrl } from "../../lib/googleMaps";
import { phoneLabel, telHref, urlLabel } from "../../lib/scheduleDetails";

interface Details {
  type: string;
  address?: string | null;
  phone?: string | null;
  url?: string | null;
  openingHours?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

const LINK = "inline-flex min-w-0 items-center gap-1 text-accent active:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const TEXT = "inline-flex min-w-0 items-center gap-1 text-slate-500";

/**
 * 予定の詳細を、1項目1行で出す(src/lib/scheduleDetails.ts)。住所は地図、電話はかける、URLは開く。
 * 共有したしおり(ログインしていない人が見る)でも使うので、URL は http(s) のものだけをリンクにする。
 */
export function ScheduleDetailLines({ item }: { item: Details }) {
  const tel = telHref(item.phone ?? undefined);
  const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : undefined;
  const stay = item.type === "lodging" && (item.checkInTime || item.checkOutTime);
  if (!item.address && !item.phone && !item.url && !item.openingHours && !stay) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-xs">
      {item.address && (
        <a className={LINK} href={buildMapSearchUrl(item.address)} target="_blank" rel="noreferrer">
          <MapPinHouse size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{item.address}</span>
        </a>
      )}
      {item.phone &&
        (tel ? (
          <a className={LINK} href={tel}>
            <Phone size={12} className="shrink-0" aria-hidden="true" />
            {phoneLabel(item.phone)}
          </a>
        ) : (
          <span className={TEXT}>
            <Phone size={12} className="shrink-0" aria-hidden="true" />
            {phoneLabel(item.phone)}
          </span>
        ))}
      {url && (
        <a className={LINK} href={url} target="_blank" rel="noreferrer">
          <Globe size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{urlLabel(url)}</span>
        </a>
      )}
      {item.openingHours && item.type !== "lodging" && (
        <span className={TEXT}>
          <Clock size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">営業 {item.openingHours}</span>
        </span>
      )}
      {stay && (
        <span className={TEXT}>
          <BedDouble size={12} className="shrink-0" aria-hidden="true" />
          {[item.checkInTime && `チェックイン ${item.checkInTime}`, item.checkOutTime && `チェックアウト ${item.checkOutTime}`].filter(Boolean).join(" / ")}
        </span>
      )}
    </div>
  );
}
