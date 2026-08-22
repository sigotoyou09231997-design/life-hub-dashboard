import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { Field } from "./Field";

interface Common {
  label?: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement>, Common {}

export function Input({ label, optional, hint, error, className = "", ...props }: InputProps) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error}>
      <input className={`field-shell ${className}`} {...props} />
    </Field>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, Common {}

export function Textarea({ label, optional, hint, error, className = "", ...props }: TextareaProps) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error}>
      <textarea className={`field-shell ${className}`} {...props} />
    </Field>
  );
}

interface AmountProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type">, Common {}

/** 金額専用。¥ を固定の飾りとして持ち、数字は等幅で大きく出す。金額を
 *  「17万」のように丸めて表示しないのはこの app の決め事。 */
export function AmountInput({ label, optional, hint, error, className = "", ...props }: AmountProps) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error}>
      <span className="field-shell field-shell--amount">
        <span aria-hidden="true">¥</span>
        <input type="number" inputMode="numeric" className={className} {...props} />
      </span>
    </Field>
  );
}
