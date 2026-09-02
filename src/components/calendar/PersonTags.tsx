import type { CalendarEvent, EventPerson } from "../../types";
import { personColorHex, resolvePeople } from "../../lib/eventPeople";

interface Props {
  /** 予定そのもの、または personIds だけを持つ形(横断検索の1行など)。 */
  event: Pick<CalendarEvent, "personIds">;
  people: EventPerson[];
  /** 狭い所(ホームの一覧・横断検索)で使う小さい版。 */
  compact?: boolean;
}

/**
 * 予定に付いている「誰の予定か」を、押せない印として並べる。
 *
 * 付けたのに画面のどこにも出ないと、付いているのか分からない(2026-09-03の指摘)。
 * 予定を出すところでは、この1つを置いて同じ見た目に揃える。
 * 誰も付いていない予定では何も描かない — 印の無い予定にまで「未設定」と出すと、
 * 使っていない人の画面が印だらけになるため。
 */
export function PersonTags({ event, people, compact }: Props) {
  const assigned = resolvePeople(event, people);
  if (assigned.length === 0) return null;

  return (
    <span className={`person-tags${compact ? " person-tags--compact" : ""}`}>
      {assigned.map((person) => (
        <span key={person.id} className="person-tag" style={{ ["--person" as string]: personColorHex(person) }}>
          <span className="person-tag__dot" aria-hidden="true" />
          {person.name}
        </span>
      ))}
    </span>
  );
}
