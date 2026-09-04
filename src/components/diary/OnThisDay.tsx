import { History } from "lucide-react";
import type { OnThisDayEntry } from "../../lib/diaryEntries";
import { formatDisplayDate } from "../../lib/date";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";

interface Props {
  items: OnThisDayEntry[];
  onOpen?: (item: OnThisDayEntry) => void;
}

/** 過去の同じ月日に書いた日記。該当が無い日は何も描かない(呼び出し側で分岐しなくてよいように、
 * ここで null を返す)。 */
export function OnThisDay({ items, onOpen }: Props) {
  if (items.length === 0) return null;

  return (
    <Card className="diary-onthisday" data-page-block>
      <header className="diary-onthisday__head">
        <History size={16} />
        <h2>{items[0].yearsAgo}年前の今日</h2>
        {items.length > 1 && <span>{items.length}件</span>}
      </header>

      <ul className="diary-onthisday__list">
        {items.map(({ entry, yearsAgo }) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen?.({ entry, yearsAgo })}
              disabled={!onOpen}
              aria-label={`${formatDisplayDate(entry.date)}の日記を開く`}
            >
              <span className="diary-onthisday__meta">
                <Badge tone="accent">{yearsAgo}年前</Badge>
                <span className="diary-onthisday__date">{formatDisplayDate(entry.date)}</span>
                {entry.tripId && <span className="diary-onthisday__trip">旅行中</span>}
              </span>
              <span className="diary-onthisday__body">{entry.body}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
