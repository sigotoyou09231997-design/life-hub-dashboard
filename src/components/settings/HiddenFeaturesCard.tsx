import { LayoutGrid } from "lucide-react";
import { useHiddenFeatures } from "../../hooks/useHiddenFeatures";
import { HIDEABLE_FEATURES, setFeatureHidden, type HideableFeature } from "../../lib/hiddenFeatures";
import { pushHiddenFeatures } from "../../lib/hiddenFeaturesSync";
import { Card } from "../ui/Card";
import { SwitchField } from "../ui/SwitchField";

/**
 * 設定の「使う機能」(2026-10-13、本人「不要な機能は非表示にしたい」「アカウントごとに」)。
 * オフにした機能は、メニュー・ホームのカード・「＋」・検索の候補から消える。データは消えず、オンに戻せばそのまま出る。
 * いまのアカウントの設定で、同じアカウントでログインした別の端末にも揃う(src/lib/hiddenFeaturesSync.ts)。
 */
export function HiddenFeaturesCard() {
  const hidden = useHiddenFeatures();

  function handleChange(key: HideableFeature, visible: boolean) {
    const next = setFeatureHidden(key, !visible);
    void pushHiddenFeatures(next);
  }

  return (
    <Card className="system-section system-section--features lg:col-span-2">
      <div className="system-section__header">
        <div className="system-section__identity">
          <span>
            <LayoutGrid size={17} />
          </span>
          <div>
            <h2>使う機能</h2>
          </div>
        </div>
      </div>
      <p className="system-section__description text-xs text-slate-500">
        使わない機能は、オフにするとメニュー・ホーム・「＋」・検索から消えます。データは消えません。いつでもオンに戻せます。
        この設定は、いまのアカウントごとに覚えて、別の端末にも揃います。ホームと設定は隠せません。
      </p>
      <div className="flex flex-col gap-2" role="group" aria-label="使う機能">
        {HIDEABLE_FEATURES.map((feature) => (
          <SwitchField
            key={feature.key}
            label={feature.label}
            hint={feature.note}
            checked={!hidden.includes(feature.key)}
            onChange={(visible) => handleChange(feature.key, visible)}
          />
        ))}
      </div>
    </Card>
  );
}
