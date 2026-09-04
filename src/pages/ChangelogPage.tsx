import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { CHANGELOG, groupChangelogByDate, unreadChangelog } from "../lib/changelog";
import { getSeenChangelogId, markChangelogSeen } from "../lib/changelogSeen";
import { formatDisplayDate } from "../lib/date";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";

export default function ChangelogPage() {
  // 開いた時点の「どこまで読んだか」を1回だけ覚えてから、読んだ印を進める。
  // 進めてから読むと、開いたその場で新着の印が消えて、何が新しかったのか分からなくなる。
  const [seenAtOpen] = useState(() => getSeenChangelogId());
  useEffect(() => {
    markChangelogSeen();
  }, []);

  const unreadIds = new Set(unreadChangelog(seenAtOpen).map((entry) => entry.id));

  return (
    <div className="spatial-page changelog-page micro-contrast mx-auto max-w-[880px] pb-10 lg:pb-8">
      <PageHeader title="更新履歴" subtitle="このアプリに入った変更" backTo="/settings" />

      <div className="spatial-page-content space-y-5 px-5 lg:px-8">
        <p className="text-xs text-slate-500">
          使う人から見て何が変わったかだけを載せています。新しいものが上です。
        </p>

        {groupChangelogByDate(CHANGELOG).map((group) => (
          <section key={group.date}>
            <div className="changelog-date">
              <h2>{formatDisplayDate(group.date)}</h2>
              <span>{group.items.length}件</span>
            </div>

            <div className="mt-2.5 space-y-2.5">
              {group.items.map((entry) => (
                <Card key={entry.id} className="changelog-entry">
                  <div className="changelog-entry__head">
                    <span className="changelog-entry__area">{entry.area}</span>
                    {unreadIds.has(entry.id) && <Badge tone="accent">新着</Badge>}
                  </div>
                  <h3 className="changelog-entry__title">
                    <Sparkles size={14} />
                    {entry.title}
                  </h3>
                  <p className="changelog-entry__body">{entry.description}</p>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
