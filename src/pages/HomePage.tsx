import { format } from "date-fns";
import { PageHeader } from "../components/ui/PageHeader";
import { TodayBudgetCard } from "../components/home/TodayBudgetCard";
import { TodayScheduleCard } from "../components/home/TodayScheduleCard";
import { TodayTasksCard } from "../components/home/TodayTasksCard";
import { TodayGoalsCard } from "../components/home/TodayGoalsCard";
import { HabitsCard } from "../components/home/HabitsCard";
import { RecentNotesCard } from "../components/home/RecentNotesCard";

export default function HomePage() {
  return (
    <div className="pb-28">
      <PageHeader title="LIFE HUB" subtitle={format(new Date(), "yyyy年M月d日(E)")} />
      <div className="space-y-3 px-5">
        <TodayBudgetCard />
        <TodayScheduleCard />
        <TodayTasksCard />
        <TodayGoalsCard />
        <HabitsCard />
        <RecentNotesCard />
      </div>
    </div>
  );
}
