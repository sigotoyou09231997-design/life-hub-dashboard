import { serviceLook } from "../../lib/subscriptionTemplates";

interface Props {
  title: string;
  serviceKey?: string | null;
  size?: "sm" | "md" | "lg";
}

/** サービスのアイコン。本物のロゴは使わず、ブランドの色の角丸に頭文字を置く。
 * お手本に無いものは青緑の薄い面に頭文字(お金管理の他の一覧と同じ見た目)。 */
export function ServiceIcon({ title, serviceKey, size = "md" }: Props) {
  const look = serviceLook(title, serviceKey);
  const long = look.mark.length > 1;
  return (
    <span
      aria-hidden="true"
      className={`subs-icon subs-icon--${size}${look.branded ? "" : " is-plain"}${long ? " is-long" : ""}`}
      style={look.branded ? { background: look.color, color: look.ink } : undefined}
    >
      {look.mark}
    </span>
  );
}
