import { useState } from "react";
import { BedDouble, ChevronDown, Clock, Globe, MapPin, MapPinHouse, Phone } from "lucide-react";
import { buildMapSearchUrl } from "../../lib/googleMaps";
import { phoneLabel, telHref, urlLabel } from "../../lib/scheduleDetails";

interface Details {
  type: string;
  address?: string | null;
  /** 移動の目的地の住所。 */
  endAddress?: string | null;
  phone?: string | null;
  url?: string | null;
  openingHours?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

/**
 * 予定の詳細(src/lib/scheduleDetails.ts)。
 *
 * 2026-10-16(UI/UX 調査メモ 第6弾 D-3)までは、住所・電話・URL・営業時間を1項目1行の青緑の文字で並べていて、
 * レンタカーの1件で5行の「文字の壁」になっていた。いまは、押せるもの(地図・電話・サイト)を 28px のアイコンの
 * ボタンにして横に並べ、住所の全文・営業時間・チェックインは「詳細」を押した時だけ開く(開閉は覚えない)。
 * 青緑は押せるものだけに使う。
 *
 * 共有したしおり(ログインしていない人が見る)でも使うので、URL は http(s) のものだけをリンクにする。
 */
export function ScheduleDetailLines({ item }: { item: Details }) {
  const [open, setOpen] = useState(false);
  const tel = telHref(item.phone ?? undefined);
  const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : undefined;
  const stay = item.type === "lodging" && (item.checkInTime || item.checkOutTime);
  const transport = item.type === "transport";
  const endAddress = transport ? item.endAddress : null;
  const hours = item.openingHours && item.type !== "lodging" ? item.openingHours : null;
  const phoneText = item.phone && !tel ? phoneLabel(item.phone) : null;
  const hasDetails = Boolean(item.address || endAddress || hours || stay || phoneText);
  if (!hasDetails && !tel && !url) return null;
  const startLabel = transport && endAddress && item.address ? `出発 ${item.address}` : item.address;
  const endLabel = endAddress && item.address ? `到着 ${endAddress}` : endAddress;

  return (
    <div className="sched-detail">
      <div className="sched-detail__actions">
        {item.address && (
          <a className="sched-detail__btn" href={buildMapSearchUrl(item.address)} target="_blank" rel="noreferrer" aria-label={`地図 ${startLabel}`} title={startLabel ?? undefined}>
            <MapPin size={14} aria-hidden="true" />
          </a>
        )}
        {endAddress && (
          <a className="sched-detail__btn" href={buildMapSearchUrl(endAddress)} target="_blank" rel="noreferrer" aria-label={`地図 ${endLabel}`} title={endLabel ?? undefined}>
            <MapPinHouse size={14} aria-hidden="true" />
          </a>
        )}
        {tel && (
          <a className="sched-detail__btn" href={tel} aria-label={`電話 ${phoneLabel(item.phone!)}`} title={phoneLabel(item.phone!)}>
            <Phone size={14} aria-hidden="true" />
          </a>
        )}
        {url && (
          <a className="sched-detail__btn" href={url} target="_blank" rel="noreferrer" aria-label={`サイト ${urlLabel(url)}`} title={urlLabel(url)}>
            <Globe size={14} aria-hidden="true" />
          </a>
        )}
        {hasDetails && (
          <button type="button" className="sched-detail__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            詳細
            <ChevronDown size={13} className="sched-detail__chevron" aria-hidden="true" />
          </button>
        )}
      </div>
      {open && hasDetails && (
        <div className="sched-detail__lines">
          {item.address && (
            <span className="sched-detail__line">
              <MapPin size={12} className="shrink-0" aria-hidden="true" />
              <span>{startLabel}</span>
            </span>
          )}
          {endAddress && (
            <span className="sched-detail__line">
              <MapPinHouse size={12} className="shrink-0" aria-hidden="true" />
              <span>{endLabel}</span>
            </span>
          )}
          {phoneText && (
            <span className="sched-detail__line">
              <Phone size={12} className="shrink-0" aria-hidden="true" />
              {phoneText}
            </span>
          )}
          {hours && (
            <span className="sched-detail__line">
              <Clock size={12} className="shrink-0" aria-hidden="true" />
              <span>営業 {hours}</span>
            </span>
          )}
          {stay && (
            <span className="sched-detail__line">
              <BedDouble size={12} className="shrink-0" aria-hidden="true" />
              {[item.checkInTime && `チェックイン ${item.checkInTime}`, item.checkOutTime && `チェックアウト ${item.checkOutTime}`].filter(Boolean).join(" / ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
