import { useMemo, useState } from "react";
import { ArrowLeft, PencilLine, Search } from "lucide-react";
import {
  SUBSCRIPTION_TEMPLATES,
  TEMPLATE_PRICES_CHECKED_AT,
  groupTemplatesByService,
  type SubscriptionTemplate,
} from "../../lib/subscriptionTemplates";
import { ServiceIcon } from "./ServiceIcon";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

const ALL = "すべて";

interface Props {
  /** null は「自分で入力する」。 */
  onPick: (template: SubscriptionTemplate | null) => void;
}

/**
 * 追加の1段目: 人気のサービスから選ぶ(参考: サブスクBOX)。プランが複数あるサービスは、
 * 押すとプランを選ぶ一覧に変わる。選んだあとのフォームで金額は直せる。
 */
export function ServicePicker({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [service, setService] = useState<string | null>(null);

  const groups = useMemo(() => groupTemplatesByService(), []);
  const categories = useMemo(() => [ALL, ...new Set(SUBSCRIPTION_TEMPLATES.map((t) => t.category))], []);

  const normalized = query.trim().toLowerCase().replace(/\s+/g, "");
  const shown = groups.filter(({ service: name, plans }) => {
    if (category !== ALL && !plans.some((plan) => plan.category === category)) return false;
    if (!normalized) return true;
    return name.toLowerCase().replace(/\s+/g, "").includes(normalized);
  });

  const plans = service ? groups.find((group) => group.service === service)?.plans ?? [] : [];

  if (service && plans.length > 0) {
    return (
      <div className="subs-picker">
        <button type="button" className="subs-link subs-picker__back" onClick={() => setService(null)}>
          <ArrowLeft size={15} aria-hidden="true" /> サービスを選び直す
        </button>
        <div className="subs-picker__plan-head">
          <ServiceIcon title={service} serviceKey={plans[0].key} size="lg" />
          <strong>{service}</strong>
        </div>
        <div className="warm-card lh-group">
          {plans.map((plan) => (
            <button key={plan.key} type="button" className="lh-row subs-row" onClick={() => onPick(plan)}>
              <span className="lh-row__copy">
                <strong>{plan.plan ?? plan.service}</strong>
                <small>{plan.cycle === "yearly" ? "年払い" : "月払い"} · {plan.category}</small>
              </span>
              <span className="subs-row__amount">
                {yen(plan.price)}
                <small>{plan.cycle === "yearly" ? "/年" : "/月"}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="subs-picker">
      <label className="subs-picker__search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="サービス名でさがす"
          aria-label="サービス名でさがす"
        />
      </label>

      <div className="subs-chips" role="group" aria-label="カテゴリで絞る">
        {categories.map((name) => (
          <button
            key={name}
            type="button"
            className="subs-chip"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="subs-picker__grid">
        <button type="button" className="subs-tile subs-tile--custom" onClick={() => onPick(null)}>
          <span className="subs-icon subs-icon--lg is-plain" aria-hidden="true">
            <PencilLine size={18} />
          </span>
          <strong>自分で入力</strong>
          <small>家賃・ジムなども</small>
        </button>
        {shown.map(({ service: name, plans: options }) => {
          const cheapest = Math.min(...options.map((plan) => plan.price));
          return (
            <button
              key={name}
              type="button"
              className="subs-tile"
              onClick={() => (options.length === 1 ? onPick(options[0]) : setService(name))}
            >
              <ServiceIcon title={name} serviceKey={options[0].key} size="lg" />
              <strong>{name}</strong>
              <small>
                {yen(cheapest)}
                {options.length > 1 ? "〜" : options[0].cycle === "yearly" ? "/年" : "/月"}
              </small>
            </button>
          );
        })}
      </div>
      {shown.length === 0 && <p className="subs-empty">見つかりません。「自分で入力」から登録できます。</p>}
      <p className="subs-picker__note">料金は{TEMPLATE_PRICES_CHECKED_AT}時点の目安です。選んだあとで直せます。</p>
    </div>
  );
}
