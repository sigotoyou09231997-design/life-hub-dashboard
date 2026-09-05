import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  endTripShare,
  loadTripShare,
  setTripShareExpenses,
  shareUrlFor,
  startTripShare,
  type TripShare,
} from "../../lib/tripShare";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { SwitchField } from "../ui/SwitchField";
import { useToast } from "../ui/ToastProvider";
import { useConfirm } from "../ui/ConfirmProvider";

interface Props {
  tripId: string;
  tripName: string;
  onClose: () => void;
}

/**
 * 旅行のしおりの共有設定(supabase/sql/023_trip_shares.sql)。
 *
 * 共有の状態は端末の中ではなく Supabase にしか無いので、開くたびに読みに行く。
 * オフラインだとここは操作できない — 「OFFにしたら即座に無効」を守るには、
 * 送信待ちの状態を作らないのが確実なため。
 */
export function TripShareSheet({ tripId, tripName, onClose }: Props) {
  const showToast = useToast();
  const confirm = useConfirm();
  const [share, setShare] = useState<TripShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 共有を始める前に決めておく「費用を含めるか」。共有中は share 側の値を使う。 */
  const [includeExpenses, setIncludeExpenses] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await loadTripShare(tripId);
        if (!active) return;
        setShare(current);
        setIncludeExpenses(current?.includeExpenses ?? false);
      } catch (error) {
        console.error("[share] failed to load share state:", error);
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tripId]);

  async function handleStart() {
    setBusy(true);
    try {
      const created = await startTripShare(tripId, includeExpenses);
      setShare(created);
      setFailed(false);
      showToast("共有リンクを作りました");
    } catch (error) {
      console.error("[share] failed to start sharing:", error);
      showToast("共有を始められませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    const ok = await confirm({
      title: "共有をやめますか?",
      message: "いま配っているリンクはすぐに見られなくなります。もう一度共有するときは、新しいリンクになります。",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await endTripShare(tripId);
      setShare(null);
      showToast("共有をやめました");
    } catch (error) {
      console.error("[share] failed to end sharing:", error);
      showToast("共有をやめられませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleExpenses(next: boolean) {
    if (!share) {
      setIncludeExpenses(next);
      return;
    }
    setBusy(true);
    try {
      await setTripShareExpenses(tripId, next);
      setShare({ ...share, includeExpenses: next });
      setIncludeExpenses(next);
    } catch (error) {
      console.error("[share] failed to switch expense sharing:", error);
      showToast("切り替えられませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!share) return;
    const url = shareUrlFor(share.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードを許していない端末では、下の入力欄から手で選んでもらう。
      showToast("コピーできませんでした。下のリンクを長押しして選んでください");
    }
  }

  if (loading) {
    return (
      <p className="py-6 text-center text-sm text-slate-400" role="status" aria-live="polite">
        読み込み中…
      </p>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          共有の設定を読めませんでした。通信できる場所で開き直してください。
        </p>
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        {share
          ? `「${tripName}」は共有中です。リンクを知っている人は、ログインせずに日程・持ち物・ルートを見られます。`
          : `「${tripName}」の日程・持ち物・ルートを、リンクを知っている人だけが見られる形で共有します。編集はできません。`}
      </p>

      <SwitchField
        label="費用も共有する"
        hint="同行者と割り勘を確かめるとき用。日記はどの設定でも共有されません。"
        checked={share ? share.includeExpenses : includeExpenses}
        onChange={(next) => void handleToggleExpenses(next)}
      />

      {share ? (
        <>
          <div className="flex flex-col gap-2">
            <Input
              label="共有リンク"
              hint="このURLを知っている人は誰でも見られます。渡す相手に気をつけてください。"
              readOnly
              value={shareUrlFor(share.token)}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button variant="secondary" onClick={() => void handleCopy()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "コピーしました" : "リンクをコピー"}
            </Button>
          </div>
          <Button variant="danger" disabled={busy} onClick={() => void handleEnd()}>
            共有をやめる
          </Button>
        </>
      ) : (
        <Button disabled={busy} onClick={() => void handleStart()}>
          共有リンクを作る
        </Button>
      )}
    </div>
  );
}
