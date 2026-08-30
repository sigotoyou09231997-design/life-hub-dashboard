import { useState } from "react";
import { Briefcase, CalendarCheck2, ChevronDown, Pencil, Trash2 } from "lucide-react";
import type { JobApplication } from "../../types";
import { formatCompactDate, todayStr } from "../../lib/date";
import { getJobStage, groupJobApplications, isNextDatePast } from "../../lib/jobApplications";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  applications: JobApplication[];
  onEdit: (application: JobApplication) => void;
  onDelete: (application: JobApplication) => void;
  onAdd: () => void;
}

function JobRow({ application, onEdit, onDelete }: { application: JobApplication } & Pick<Props, "onEdit" | "onDelete">) {
  const stage = getJobStage(application.stage);
  const past = isNextDatePast(application, todayStr());

  return (
    <Card className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-slate-800">{application.companyName}</p>
          <Badge tone={stage.tone}>{stage.label}</Badge>
        </div>
        {application.role && <p className="mt-0.5 truncate text-xs text-slate-500">{application.role}</p>}
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarCheck2 size={13} />
          {application.nextDate ? (
            <>
              <span className={past ? "text-danger" : ""}>
                {formatCompactDate(application.nextDate)}
                {application.nextTime && ` ${application.nextTime}`}
              </span>
              {/* 日が過ぎたまま段階が変わっていない = 結果の記録を忘れている見込み。 */}
              {past && <span className="text-danger">結果を記録しましょう</span>}
            </>
          ) : (
            "次の予定は未定"
          )}
        </p>
        {application.memo && <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-500">{application.memo}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(application)}
          aria-label={`${application.companyName}を編集`}
          className="rounded-lg p-2 text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(application)}
          aria-label={`${application.companyName}を削除`}
          className="rounded-lg p-2 text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </Card>
  );
}

export function JobApplicationList({ applications, onEdit, onDelete, onAdd }: Props) {
  // 終わったぶんは、数だけ見えていれば普段は畳んでおきたい(応募が増えるほど下に伸びるため)。
  const [showClosed, setShowClosed] = useState(false);
  const { active, closed } = groupJobApplications(applications);

  if (applications.length === 0) {
    return (
      <EmptyState
        card
        icon={Briefcase}
        title="応募先はまだありません"
        description="会社名と今の段階を登録すると、次の予定が近い順に並びます。"
        action={{ label: "応募先を追加", onClick: onAdd }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {active.length > 0 ? (
        <div className="space-y-2.5">
          {active.map((application) => (
            <JobRow key={application.id} application={application} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <EmptyState
          card
          icon={Briefcase}
          title="選考中の応募先はありません"
          description="終わったぶんは下にまとめてあります。"
          action={{ label: "応募先を追加", onClick: onAdd }}
        />
      )}

      {closed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowClosed((value) => !value)}
            aria-expanded={showClosed}
            className="glass-row flex min-h-11 w-full items-center justify-between rounded-xl px-4 text-sm font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <span>終わった応募 {closed.length} 件</span>
            <ChevronDown
              size={17}
              style={{ transform: showClosed ? "rotate(180deg)" : undefined, transition: "transform 220ms" }}
            />
          </button>
          {showClosed && (
            <div className="mt-2.5 space-y-2.5">
              {closed.map((application) => (
                <JobRow key={application.id} application={application} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
