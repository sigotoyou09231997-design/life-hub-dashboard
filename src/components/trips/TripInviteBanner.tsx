import { useState } from "react";
import { Users } from "lucide-react";
import { useIncomingInvites } from "../../hooks/useTripCollab";
import { collabErrorText, respondToInvite, type Collaborator } from "../../lib/tripCollab";
import { formatDisplayDate } from "../../lib/date";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { useToast } from "../ui/ToastProvider";

function invitePeriod(invite: Collaborator): string {
  if (!invite.tripStartDate) return "";
  const start = formatDisplayDate(invite.tripStartDate);
  return invite.tripEndDate && invite.tripEndDate !== invite.tripStartDate ? `${start} 〜 ${formatDisplayDate(invite.tripEndDate)}` : start;
}

/**
 * 旅行への招待(supabase/sql/034_trip_members.sql)。自分のメールアドレス宛てに届いた、承認待ちのものを出す。
 * 「参加する」と「断る」は別々のボタン。参加するまで、その旅行の中身は読めない。
 * 招待が無い間は何も出さない(034 が無い・通信できない時も同じ)。
 */
export function TripInviteBanner({ className = "" }: { className?: string }) {
  const invites = useIncomingInvites();
  const showToast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (invites.length === 0) return null;

  async function answer(invite: Collaborator, accept: boolean) {
    setBusyId(invite.id);
    try {
      await respondToInvite(invite.tripId, accept);
      showToast(accept ? `「${invite.tripName}」に参加しました` : "招待を断りました");
    } catch (error) {
      showToast(collabErrorText(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`trip-invites flex flex-col gap-3 ${className}`} aria-label="旅行への招待">
      {invites.map((invite) => (
        <Card key={invite.id} className="trip-invite flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Users size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {invite.ownerEmail ? `${invite.ownerEmail} さんから、` : ""}旅行「{invite.tripName || "名前のない旅行"}」への招待が届いています
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {[invite.tripDestination, invitePeriod(invite)].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                参加すると、日程・持ち物・ルート・費用を一緒に編集できます。日記は共有されません。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busyId === invite.id} onClick={() => void answer(invite, true)}>
              参加する
            </Button>
            <Button variant="secondary" disabled={busyId === invite.id} onClick={() => void answer(invite, false)}>
              断る
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
