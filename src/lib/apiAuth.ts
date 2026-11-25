import { auth } from "./supabase";

/** AI を使うサーバーの窓口(api/extractReceipt・extractTripPlan・generateDraft・suggestPlaces)は、ログイン中の人しか
 * 使えない(呼ぶたびに本人の料金がかかるため。2026-11-26)。その窓口へ送る時に付ける、ログインの証明。
 * ログインしていなければ空(サーバーが「ログインしてから使ってください」と断る)。 */
export async function authorizationHeader(): Promise<Record<string, string>> {
  try {
    const token = (await auth.getSession()).data.session?.access_token;
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
