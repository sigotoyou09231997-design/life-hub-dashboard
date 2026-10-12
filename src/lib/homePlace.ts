import { useSyncExternalStore } from "react";
import { routeKey } from "./mailPlanImport";

/**
 * 旅行の日程の「場所」に書かれた「自宅」「家」を、地図の経路でどう扱うか。
 *
 * 経路の地図は日程の「場所」の文字をそのまま Google マップに渡しているので、「自宅」が
 * 名前の似たお店(「お家サロン 縁 yukari」)に当たって、出発地がそのお店になっていた
 * (2026-10-12、UI/UX 調査メモ 第3弾 N-2)。設定に自宅の住所があればそれに置き換え、
 * 無ければ経路から外す。
 *
 * 住所は**この端末にだけ**覚える(同期しない)。経路の選び方(TripDayRoute.tsx)も端末ごとなのと、
 * 自宅の住所をサーバーに置かずに済むため。
 */
const HOME_ADDRESS_KEY = "lifehub.homeAddress";
const CHANGE_EVENT = "lifehub:home-address";

/** 「自宅」「家から」「帰宅」「自宅（出発）」など、家そのものを指す書き方か。
 * 「お家サロン」「家具屋」のように後ろに名前が続くものは店などなので当てない(全体が一致した時だけ)。 */
const HOME_PATTERN =
  /^(?:自宅|家|我が家|わが家|おうち|お家|自分の家|帰宅)(?:から|へ|まで|に帰る|へ帰る|に戻る|出発|到着|着|帰宅)?$/;

export function isHomePlace(place: string): boolean {
  // 空白と、後ろに付けた「（出発）」のような括弧書きは見ない。
  const text = place.replace(/[\s　]+/g, "").replace(/[（(][^）)]*[）)]$/, "");
  return HOME_PATTERN.test(text);
}

export interface ResolvedStops {
  stops: string[];
  /** 住所が無いので、経路から外した「自宅」があったか。 */
  homeSkipped: boolean;
}

/**
 * 経路の地点の並びの「自宅」を、住所に置き換える(住所が無ければ外す)。
 * 置き換えたあと同じ場所が続いたら1つにまとめる(dayRouteStops と同じ決まり)。
 */
export function resolveHomeStops(stops: string[], homeAddress: string | undefined): ResolvedStops {
  const address = homeAddress?.trim();
  let homeSkipped = false;
  const replaced: string[] = [];
  for (const stop of stops) {
    if (!isHomePlace(stop)) {
      replaced.push(stop);
    } else if (address) {
      replaced.push(address);
    } else {
      homeSkipped = true;
    }
  }
  return {
    stops: replaced.filter((place, index) => index === 0 || routeKey(place) !== routeKey(replaced[index - 1])),
    homeSkipped,
  };
}

export function readHomeAddress(): string {
  try {
    return window.localStorage.getItem(HOME_ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveHomeAddress(address: string): void {
  try {
    const trimmed = address.trim();
    if (trimmed) window.localStorage.setItem(HOME_ADDRESS_KEY, trimmed);
    else window.localStorage.removeItem(HOME_ADDRESS_KEY);
  } catch {
    // 覚えられない環境では、住所は使えない(「自宅」は経路から外れるだけ)
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // ほかのタブで変えた時も追う
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** この端末に覚えた自宅の住所(無ければ空)。設定で変えると、開いている地図もすぐ変わる。 */
export function useHomeAddress(): string {
  return useSyncExternalStore(subscribe, readHomeAddress, () => "");
}
