import type { SelectHTMLAttributes, ReactNode } from "react";
import { Field } from "./Field";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
}

/** 選択肢が5つ以上あるときのプルダウン。3〜4つなら SegmentedField を使う
 *  (開くまで何が選べるか分からない部品を、少ない選択肢に使わないため)。 */
export function Select({ label, optional, hint, error, className = "", children, ...props }: Props) {
  return (
    <Field label={label} optional={optional} hint={hint} error={error}>
      <select className={`field-shell ${className}`} {...props}>
        {children}
      </select>
    </Field>
  );
}
