import { useHiddenFeaturesSync } from "../../hooks/useHiddenFeatures";

/** 何も描かない。隠す機能の設定を、アカウントに紐づけて別の端末とそろえる見張り(src/lib/hiddenFeaturesSync.ts)。 */
export function HiddenFeaturesSync(): null {
  useHiddenFeaturesSync();
  return null;
}
