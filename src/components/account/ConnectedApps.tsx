import { useEffect, useState } from "react";
import { PlugZap } from "lucide-react";
import { auth } from "../../lib/supabase";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface Grant {
  clientId: string;
  name: string;
  grantedAt: string;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * ChatGPT などの外のアプリに、この LIFE HUB のアカウントへの接続を許している一覧と、取り消し
 * (src/lib/oauthConsent.ts の同意画面で許可したもの)。同意画面の「いつでも外せます」の受け皿。
 * 取り消すと、そのアプリのログインと、使い回しのトークン(リフレッシュトークン)がその場で無効になる。
 * 1件も無ければ、何も出さない(使っていない人の画面を増やさない)。
 */
export function ConnectedApps() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await auth.oauth.listGrants();
        if (error || !data || !active) return;
        setGrants(data.map((grant) => ({ clientId: grant.client.id, name: grant.client.name || "(名前のないアプリ)", grantedAt: grant.granted_at })));
      } catch {
        // OAuth サーバーが無効・通信できない時は、欄ごと出さない(任意の機能のため)。
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (grants.length === 0 && !message) return null;

  async function revoke(clientId: string) {
    setBusy(true);
    setMessage("");
    try {
      const { error } = await auth.oauth.revokeGrant({ clientId });
      if (error) throw error;
      setGrants((current) => current.filter((grant) => grant.clientId !== clientId));
      setConfirming(null);
      setMessage("接続を外しました。そのアプリは、もうこのアカウントを使えません。");
    } catch (err) {
      console.error("[connectedApps] failed to revoke:", err);
      setMessage("接続を外せませんでした。通信を確かめて、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:col-span-2" aria-label="接続しているアプリ">
      <div className="profile-module__header">
        <div><h2>接続しているアプリ</h2></div>
        <PlugZap size={17} />
      </div>
      <p className="profile-module__description text-xs text-slate-500">
        ChatGPT などに、LIFE HUB の旅行を読み書きすることを許している接続です。外すと、そのアプリはすぐに使えなくなります。
      </p>
      <ul className="mt-3 space-y-2">
        {grants.map((grant) => (
          <li key={grant.clientId} className="space-y-2 border border-white/60 bg-white/40 p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{grant.name}</p>
                <p className="text-xs text-slate-500">{dateLabel(grant.grantedAt)}に許可</p>
              </div>
              {confirming !== grant.clientId && (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(grant.clientId)}>
                  接続を外す
                </Button>
              )}
            </div>
            {confirming === grant.clientId && (
              <div className="space-y-2" role="alert">
                <p className="text-xs leading-relaxed text-slate-700">
                  「{grant.name}」の接続を外します。もう一度使うときは、ChatGPT から接続し直します。
                </p>
                <div className="flex gap-3">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setConfirming(null)}>
                    やめる
                  </Button>
                  <Button type="button" variant="danger" className="flex-1" disabled={busy} onClick={() => revoke(grant.clientId)}>
                    外す
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p className="mt-3 px-1 text-xs leading-relaxed text-slate-700" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </Card>
  );
}
