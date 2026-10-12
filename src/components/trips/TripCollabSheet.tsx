import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useCollaborators } from "../../hooks/useTripCollab";
import {
  collabErrorText,
  inviteCollaborator,
  inviteMessage,
  isValidInviteEmail,
  leaveSharedTrip,
  removeCollaborator,
  type Collaborator,
} from "../../lib/tripCollab";
import { Button } from "../ui/Button";
import { FormPanel } from "../ui/FormPanel";
import { Input } from "../ui/Input";
import { useConfirm } from "../ui/ConfirmProvider";
import { useToast } from "../ui/ToastProvider";

interface Props {
  tripId: string;
  tripName: string;
  /** 持ち主(招待・外すができる)か、招かれて参加している人(抜けるだけができる)か。 */
  role: "owner" | "member";
  onClose: () => void;
  /** 抜けて、この旅行が端末から無くなった時。旅行の画面にいたままにしないため。 */
  onLeft?: () => void;
}

function StatusChip({ status }: { status: Collaborator["status"] }) {
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${status === "accepted" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
      {status === "accepted" ? "参加中" : "承認待ち"}
    </span>
  );
}

/**
 * 旅行を、ほかのアカウントと一緒に編集する(supabase/sql/034_trip_members.sql)。
 * 持ち主はメールアドレスで招き、参加者を外せる。招かれて参加した人は、参加者を見て、自分から抜けられる。
 * 共有するのは日程・持ち物・ルート・費用(日記は共有しない)。招待・参加者の一覧は Supabase にしかないので、開くたびに読みに行く。
 */
export function TripCollabSheet({ tripId, tripName, role, onClose, onLeft }: Props) {
  const { items, error, reload } = useCollaborators(tripId);
  const showToast = useToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const emailOk = isValidInviteEmail(email);

  async function copyInvite(address: string, id: string) {
    try {
      await navigator.clipboard.writeText(inviteMessage(tripName, address));
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      showToast("コピーできませんでした");
    }
  }

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!emailOk || busy) return;
    setBusy(true);
    try {
      const result = await inviteCollaborator(tripId, email);
      showToast(result.alreadyInvited ? "すでに招待しています" : "招待しました。相手がログインすると「参加する」が出ます");
      setEmail("");
      reload();
    } catch (failure) {
      showToast(collabErrorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member: Collaborator) {
    const pending = member.status === "pending";
    const ok = await confirm({
      title: pending ? "招待を取り消しますか?" : `${member.invitedEmail} を外しますか?`,
      confirmLabel: pending ? "取り消す" : "外す",
      message: pending
        ? "相手に「参加する」が出なくなります。"
        : "外した瞬間から、この人はこの旅行を見られず、編集もできません。この人が足した予定や費用は残ります。",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeCollaborator(member.id);
      showToast(pending ? "招待を取り消しました" : "外しました");
      reload();
    } catch (failure) {
      showToast(collabErrorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    const ok = await confirm({
      title: "この旅行から抜けますか?",
      confirmLabel: "抜ける",
      message: "この端末からこの旅行が消えます。持ち主のデータは消えません。もう一度参加するには、持ち主に招待し直してもらいます。",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await leaveSharedTrip(tripId);
      showToast("旅行から抜けました");
      onClose();
      onLeft?.();
    } catch (failure) {
      showToast(collabErrorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600" role="alert">
          {error}
        </p>
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
      </div>
    );
  }

  if (!items) {
    return (
      <p className="py-6 text-center text-sm text-slate-600" role="status" aria-live="polite">
        読み込み中…
      </p>
    );
  }

  const accepted = items.filter((member) => member.status === "accepted");
  const pending = items.filter((member) => member.status === "pending");
  const ownerEmail = items[0]?.ownerEmail ?? "";

  if (role === "member") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-700">
          {ownerEmail ? `${ownerEmail} さんの旅行に参加しています。` : "招かれて参加している旅行です。"}
          日程・持ち物・ルート・費用を、みんなで一緒に編集できます。日記・写真・書類は共有されません。
        </p>
        <ul className="flex flex-col gap-2" aria-label="参加者">
          {ownerEmail && (
            <li className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{ownerEmail}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">持ち主</span>
            </li>
          )}
          {accepted.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{member.invitedEmail}</span>
              <StatusChip status={member.status} />
            </li>
          ))}
        </ul>
        <Button variant="danger" disabled={busy} onClick={() => void handleLeave()}>
          この旅行から抜ける
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-700">
        メールアドレスで招待すると、相手が「参加する」を押したあと、「{tripName}」の日程・持ち物・ルート・費用を一緒に編集できます。日記・貼った写真・書類は共有されません（端末の中だけのため）。
      </p>

      <form className="flex flex-col gap-3" onSubmit={(event) => void handleInvite(event)}>
        <FormPanel>
          <Input
            label="招待するメールアドレス"
            hint="相手が LIFE HUB にログインするときのメールアドレスを入れてください。"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="friend@example.com"
          />
        </FormPanel>
        <Button type="submit" disabled={busy || !emailOk}>
          招待する
        </Button>
      </form>

      {items.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="招待した人">
          {[...accepted, ...pending].map((member) => (
            <li key={member.id} className="flex flex-col gap-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{member.invitedEmail}</span>
                <StatusChip status={member.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                {member.status === "pending" && (
                  <Button variant="secondary" onClick={() => void copyInvite(member.invitedEmail, member.id)}>
                    {copiedId === member.id ? <Check size={16} /> : <Copy size={16} />}
                    {copiedId === member.id ? "コピーしました" : "招待の案内をコピー"}
                  </Button>
                )}
                <Button variant="danger" disabled={busy} onClick={() => void handleRemove(member)}>
                  {member.status === "pending" ? "取り消す" : "外す"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && <p className="text-xs text-slate-600">まだ誰も招待していません。</p>}
      <p className="text-xs text-slate-600">
        招待を受けた人は、自分のアカウントでログインしたときに「参加する／断る」が出ます。外すと、その瞬間から見られなくなります。
      </p>
    </div>
  );
}
