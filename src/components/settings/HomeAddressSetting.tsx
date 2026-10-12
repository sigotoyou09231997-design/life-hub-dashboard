import { useEffect, useState } from "react";
import { House } from "lucide-react";
import { saveHomeAddress, useHomeAddress } from "../../lib/homePlace";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useToast } from "../ui/ToastProvider";

/**
 * 設定の「自宅の住所」。旅行の経路の地図で、日程の場所が「自宅」「家」の所をこの住所に置き換える
 * (src/lib/homePlace.ts)。この端末にだけ覚える。
 */
export function HomeAddressSetting() {
  const saved = useHomeAddress();
  const [draft, setDraft] = useState(saved);
  const showToast = useToast();

  // ほかのタブで変えた時など、覚えている住所が変わったら入力欄も合わせる。
  useEffect(() => setDraft(saved), [saved]);

  const changed = draft.trim() !== saved;

  function handleSave() {
    saveHomeAddress(draft);
    showToast(draft.trim() ? "自宅の住所を覚えました" : "自宅の住所を消しました");
  }

  return (
    <Card className="system-section system-section--home lg:col-span-2">
      <div className="system-section__header">
        <div className="system-section__identity">
          <span>
            <House size={17} />
          </span>
          <div>
            <h2>自宅の住所</h2>
          </div>
        </div>
        <div className={`system-status ${saved ? "is-online" : ""}`}>
          <i />
          {saved ? "登録済み" : "未登録"}
        </div>
      </div>
      <p className="system-section__description text-xs text-slate-500">
        旅行の日程で場所を「自宅」「家」にした所を、地図の経路ではこの住所として出します。
        入れていない時は、「自宅」は経路に入れません(名前の似たお店に当たってしまうため)。住所はこの端末にだけ覚えます。
      </p>
      <Input
        aria-label="自宅の住所"
        placeholder="例: 東京都世田谷区〇〇1-2-3"
        autoComplete="street-address"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="system-section__actions">
        <Button variant="secondary" className="w-full" onClick={handleSave} disabled={!changed}>
          {saved && !draft.trim() ? "住所を消す" : "保存する"}
        </Button>
      </div>
    </Card>
  );
}
