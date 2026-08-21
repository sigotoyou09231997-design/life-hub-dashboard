import { db } from "../db/schema";
import { auth, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";

/** Mirrors a block/unblock into Supabase's blocked_senders table (keyed on the
 * Supabase-Auth user + the connected Gmail account's own address, not the local
 * per-device gmailAccounts.id) so netlify/functions/checkGmailAndNotify.ts's
 * server-side poll can also skip blocked senders — without this, the local
 * db.blockedSenders write only hides mail from this device's inbox UI while the
 * background push notification (which never touches Dexie) still fires.
 *
 * That same server-side table doubles as the transport between devices: see
 * pullBlockedSenders below, which reads it back into the local list.
 *
 * Best-effort: swallows errors instead of throwing, since the local block already
 * took effect for the UI and shouldn't be undone by e.g. being offline or not
 * having a Supabase session yet. */
async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await auth.getSession();
  return data.session?.user.id ?? null;
}

/** `localId` is the db.blockedSenders row this push belongs to. On success the row
 * is stamped with `pushedAt`, which is what lets pullBlockedSenders tell "the
 * server never received this block" apart from "another device unblocked it". */
export async function blockSenderRemote(accountEmail: string, senderEmail: string, localId?: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await getSupabaseDataClient();
  const { error } = await supabase.from("blocked_senders").upsert(
    { id: crypto.randomUUID(), user_id: userId, account_email: accountEmail, sender_email: senderEmail },
    { onConflict: "user_id,account_email,sender_email" },
  );
  if (error) {
    console.error("[blockedSenders] failed to push block to Supabase:", error.message);
    return;
  }
  if (localId) await db.blockedSenders.update(localId, { pushedAt: Date.now() });
}

export async function unblockSenderRemote(accountEmail: string, senderEmail: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await getSupabaseDataClient();
  const { error } = await supabase
    .from("blocked_senders")
    .delete()
    .eq("user_id", userId)
    .eq("account_email", accountEmail)
    .eq("sender_email", senderEmail);
  if (error) console.error("[blockedSenders] failed to push unblock to Supabase:", error.message);
}

/** Guards against two mounts (GmailPage + GmailMailPage, or React StrictMode's
 * double-invoked effects in dev) running the same pull concurrently and both
 * deciding to bulkAdd the same rows. */
const pullsInFlight = new Map<string, Promise<void>>();

/** Brings other devices' blocks/unblocks into this device's local list.
 *
 * db.blockedSenders is deliberately outside the generic sync engine (src/lib/sync.ts):
 * its rows are keyed by accountId, a per-device local UUID that means nothing on
 * another device. So the server-side blocked_senders table — keyed by the portable
 * (user_id, account_email, sender_email) instead — is treated as the source of
 * truth for one account, and reconciled into the local rows here.
 *
 * A local row missing from the server is ambiguous, and `pushedAt` disambiguates it:
 *   - pushedAt set  → the server did have it once, so it's gone because another
 *                     device unblocked the sender → delete it locally too.
 *   - pushedAt unset → the push never landed (offline, no Supabase session yet) →
 *                     keep it, and let GmailInbox's self-heal effect retry the push.
 * Without that split, an unblock on the PC would be silently resurrected by the
 * phone's stale local row on its next self-heal push.
 *
 * Rows blocked before `pushedAt` existed are unset but do exist on the server, so
 * the backfill below adopts them into the "confirmed pushed" state on first run. */
export function pullBlockedSenders(accountId: string, accountEmail: string): Promise<void> {
  const existing = pullsInFlight.get(accountId);
  if (existing) return existing;
  const pull = runPull(accountId, accountEmail).finally(() => pullsInFlight.delete(accountId));
  pullsInFlight.set(accountId, pull);
  return pull;
}

async function runPull(accountId: string, accountEmail: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await getSupabaseDataClient();
  const { data, error } = await supabase
    .from("blocked_senders")
    .select("sender_email")
    .eq("user_id", userId)
    .eq("account_email", accountEmail);
  if (error) {
    console.error("[blockedSenders] failed to pull blocks from Supabase:", error.message);
    return;
  }

  const remote = new Set(((data ?? []) as { sender_email: string }[]).map((r) => r.sender_email.toLowerCase()));
  const local = await db.blockedSenders.where("accountId").equals(accountId).toArray();
  const localEmails = new Set(local.map((b) => b.email));
  const now = Date.now();

  const additions = [...remote]
    .filter((email) => !localEmails.has(email))
    .map((email) => ({ accountId, email, createdAt: now, pushedAt: now }));
  if (additions.length > 0) await db.blockedSenders.bulkAdd(additions);

  const unblockedElsewhere = local.filter((b) => b.id && b.pushedAt != null && !remote.has(b.email));
  if (unblockedElsewhere.length > 0) await db.blockedSenders.bulkDelete(unblockedElsewhere.map((b) => b.id!));

  const backfill = local.filter((b) => b.id && b.pushedAt == null && remote.has(b.email));
  for (const b of backfill) await db.blockedSenders.update(b.id!, { pushedAt: now });
}
