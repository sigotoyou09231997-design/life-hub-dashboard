import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 片方しかボタンが無いとき(削除だけ、閉じるだけ)は1列にする。 */
  single?: boolean;
}

/** シートの下に貼りつく操作。各フォームが -mx-5 で自前に持っていたものを1か所に。 */
export function FormActions({ children, single = false }: Props) {
  return <div className={`form-actions ${single ? "form-actions--single" : ""}`}>{children}</div>;
}
