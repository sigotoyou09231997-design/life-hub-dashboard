import { auth, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";

/** Mirrors a block/unblock into Supabase's blocked_senders table (keyed on the
 * Supabase-Auth user + the connected Gmail account's own address, not the local
 * per-device gmailAccounts.id) so netlify/functions/checkGmailAndNotify.ts's
 * server-side poll can also skip blocked senders — without this, the local
 * db.blockedSenders write only hides mail from this device's inbox UI while the
 * background push notification (which never touches Dexie) still fires.
 *
 * Best-effort: swallows errors instead of throwing, since the local block already
 * took effect for the UI and shouldn't be undone by e.g. being offline or not
 * having a Supabase session yet. */
async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await auth.getSession();
  return data.session?.user.id ?? null;
}

export async function blockSenderRemote(accountEmail: string, senderEmail: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await getSupabaseDataClient();
  const { error } = await supabase.from("blocked_senders").upsert(
    { id: crypto.randomUUID(), user_id: userId, account_email: accountEmail, sender_email: senderEmail },
    { onConflict: "user_id,account_email,sender_email" },
  );
  if (error) console.error("[blockedSenders] failed to push block to Supabase:", error.message);
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
