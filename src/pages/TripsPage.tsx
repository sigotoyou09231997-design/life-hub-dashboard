import { Plane } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";

export default function TripsPage() {
  return (
    <div className="pb-10">
      <PageHeader title="旅行計画" backTo="/" />
      <div className="px-5">
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-light text-accent">
            <Plane size={26} />
          </div>
          <div>
            <p className="font-semibold text-slate-900">旅行計画機能は準備中です</p>
            <p className="mt-1 text-sm text-slate-400">
              旅程・行きたい場所・予約・持ち物・予算をまとめて管理できるようにする予定です。
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
