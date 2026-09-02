import type { EventPerson } from "../../types";
import { UNASSIGNED_DOT_COLOR, UNASSIGNED_FILTER, personColorHex } from "../../lib/eventPeople";

interface Props {
  /** 並べ替え済み(sortPeople)で渡すこと。カレンダーの点の並びと揃えるため。 */
  people: EventPerson[];
  /** 選んでいる人のid。空＝絞り込んでいない(全部出す)。 */
  value: string[];
  onChange: (next: string[]) => void;
  /** 誰も付けていない予定が1件でもある時だけ「未設定」を出す。 */
  showUnassigned: boolean;
}

/**
 * カレンダーの上に出す「誰の予定か」の絞り込み。押した人の予定だけが、点にも
 * 下の一覧にも残る。何も押していない状態が「全部」。
 *
 * 絞り込むのは予定だけで、タスクと旅行の予定はそのまま残す — どちらも
 * 「誰の」を持たないので、絞ると常に消えることになり、絞り込みのたびに
 * 画面から丸ごと消えたように見えるため。
 */
export function PersonFilter({ people, value, onChange, showUnassigned }: Props) {
  if (people.length === 0) return null;

  function toggle(id: string): void {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  return (
    <div className="person-filter" role="group" aria-label="誰の予定かで絞る">
      <span className="person-filter__label">誰の</span>
      <button
        type="button"
        className={`person-chip${value.length === 0 ? " is-on" : ""}`}
        aria-pressed={value.length === 0}
        onClick={() => onChange([])}
      >
        すべて
      </button>
      {people.map((person) => {
        const on = person.id != null && value.includes(person.id);
        return (
          <button
            key={person.id}
            type="button"
            className={`person-chip${on ? " is-on" : ""}`}
            style={{ ["--person" as string]: personColorHex(person) }}
            aria-pressed={on}
            onClick={() => person.id && toggle(person.id)}
          >
            <span className="person-chip__dot" aria-hidden="true" />
            {person.name}
          </button>
        );
      })}
      {showUnassigned && (
        <button
          type="button"
          className={`person-chip${value.includes(UNASSIGNED_FILTER) ? " is-on" : ""}`}
          style={{ ["--person" as string]: UNASSIGNED_DOT_COLOR }}
          aria-pressed={value.includes(UNASSIGNED_FILTER)}
          onClick={() => toggle(UNASSIGNED_FILTER)}
        >
          <span className="person-chip__dot" aria-hidden="true" />
          未設定
        </button>
      )}
    </div>
  );
}
