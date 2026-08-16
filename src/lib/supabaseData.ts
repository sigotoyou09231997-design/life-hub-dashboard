import type { SupabaseClient } from "@supabase/supabase-js";
import { auth, getSupabaseConfig } from "./supabase";

let clientPromise: Promise<SupabaseClient> | null = null;

/** Loads PostgREST, Realtime, Storage and Functions only after authenticated
 * data access is actually needed. The custom token callback keeps Auth owned by
 * the lightweight standalone client instead of creating a second Auth client. */
export function getSupabaseDataClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => {
        const { url, anonKey } = getSupabaseConfig();
        return createClient(url, anonKey, {
          accessToken: async () => (await auth.getSession()).data.session?.access_token ?? null,
        });
      })
      .catch((error) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}
