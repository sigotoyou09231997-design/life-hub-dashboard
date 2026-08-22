import type { ReactNode } from "react";

interface Props {
  label?: string;
  /** ラベル本文に「(任意)」と書き足すのではなく、印として切り離して出す。 */
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** label 要素で包むと、中の押しボタン(日付・分類)まで巻き込んでしまう。 */
  as?: "label" | "div";
  className?: string;
  children: ReactNode;
}

/** フォームの1項目。見出し・入力・補足の並びをここ1か所で決める。 */
export function Field({ label, optional, hint, error, as = "label", className = "", children }: Props) {
  const Tag = as;
  return (
    <Tag className={`field ${error ? "has-error" : ""} ${className}`}>
      {label && (
        <span className="field__head">
          <span className="field__label">{label}</span>
          {optional && <em className="field__optional">任意</em>}
        </span>
      )}
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </Tag>
  );
}
