import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props {
  /** 面の上に置く小さな見出し。「どこへ」「いつ」など、その面が何を聞いているか。 */
  caption?: string;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}

/** 関係のある項目をひとつの面にまとめる。項目を全部同じ間隔で縦に積むと、
 *  必須とおまけの区別が付かないので、意味の切れ目を面で見せる。 */
export function FormPanel({ caption, icon: Icon, className = "", children }: Props) {
  return (
    <section className={className}>
      {caption && (
        <p className="form-panel__caption">
          {Icon && <Icon size={15} strokeWidth={2.1} />}
          {caption}
        </p>
      )}
      <div className="form-panel">
        <div className="form-panel__body">{children}</div>
      </div>
    </section>
  );
}
