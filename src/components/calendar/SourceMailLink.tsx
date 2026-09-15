import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Mail } from "lucide-react";
import type { EventMailLink } from "../../types";
import { findEventMailLink, resolveMailLinkTarget, type MailLinkTarget } from "../../lib/eventMailLink";
import { FormPanel } from "../ui/FormPanel";

/** 差出人の表示名。`山田 <yamada@example.com>` の山田だけ(無ければアドレスのまま)。 */
function senderName(sender: string | undefined): string {
  if (!sender) return "";
  const name = sender.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return name || sender.replace(/[<>]/g, "").trim();
}

/**
 * 予定の編集画面に出す「元のメール」。メールから作った予定にだけ出る
 * (src/lib/eventMailLink.ts)。つながりの無い予定では何も描かない。
 */
export function SourceMailLink({ eventId }: { eventId: string }) {
  const [found, setFound] = useState<{ link: EventMailLink; target: MailLinkTarget } | null>(null);

  useEffect(() => {
    let active = true;
    setFound(null);
    void (async () => {
      try {
        const link = await findEventMailLink(eventId);
        if (!link) return;
        const target = await resolveMailLinkTarget(link);
        if (active) setFound({ link, target });
      } catch (error) {
        // 引けなくても予定の編集はそのまま続けられるようにする(欄を出さないだけ)。
        console.error("[eventMailLink] failed to look up the source mail:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId]);

  if (!found) return null;
  const { link, target } = found;
  const linkClass =
    "inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

  return (
    <FormPanel caption="元のメール" icon={Mail}>
      <div className="flex items-center gap-3 px-[0.9rem] py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{link.subject || "(件名なし)"}</p>
          {link.sender && <p className="truncate text-xs text-slate-500">{senderName(link.sender)}</p>}
        </div>
        {target.kind === "app" ? (
          <Link to={target.to} className={linkClass}>
            元のメールを開く
          </Link>
        ) : (
          // この端末にメールが無い時はGmail本体で開く。アプリの画面を置き換えないよう別のタブにする。
          <a href={target.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Gmailで開く
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </FormPanel>
  );
}
