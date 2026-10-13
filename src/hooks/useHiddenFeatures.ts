import { useEffect, useSyncExternalStore } from "react";
import {
  featureForPath,
  getHiddenFeaturesSnapshot,
  subscribeHiddenFeatures,
  type HideableFeature,
} from "../lib/hiddenFeatures";
import { syncHiddenFeatures } from "../lib/hiddenFeaturesSync";

/** いまのアカウントで隠している機能。設定で変えると、すぐ画面に反映される。 */
export function useHiddenFeatures(): readonly HideableFeature[] {
  return useSyncExternalStore(subscribeHiddenFeatures, getHiddenFeaturesSnapshot, getHiddenFeaturesSnapshot);
}

/** この道のり(「/gmail」など)の画面は、いま隠しているか。 */
export function useIsPathHidden(path: string): boolean {
  const hidden = useHiddenFeatures();
  const feature = featureForPath(path);
  return feature !== null && hidden.includes(feature);
}

/** 開いた時と、アプリに戻った時に、サーバーの設定と突き合わせる(アプリに1つだけ置く)。 */
export function useHiddenFeaturesSync(): void {
  useEffect(() => {
    // 設定が変わった時は、saveHiddenFeatures(src/lib/hiddenFeatures.ts)が画面に知らせる。ここですることは無い。
    const sync = () => void syncHiddenFeatures();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
