import type { ReactNode } from "react";

interface Props {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** 「固定費として記録する」のような入り切り。素のチェックボックスはOSごとに
 *  大きさも形も変わるうえ的が小さいので、行ごと押せるスイッチにする。 */
export function SwitchField({ label, hint, checked, onChange }: Props) {
  return (
    <div className="field switch-field">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="switch-row"
      >
        <span className="switch-row__copy">
          <span className="field__label">{label}</span>
          {hint && <span className="field__hint">{hint}</span>}
        </span>
        <span className="switch" aria-hidden="true">
          <span className="switch__knob" />
        </span>
      </button>
    </div>
  );
}
