/** 返信しても意味のない差出人(送信専用アドレス・自動のお知らせ)かどうか。
 *
 * メール画面(DraftReview)は、ここが true の時だけ AI返信案の欄を閉じた状態で出す。
 * 以前はメルマガや「送信専用です」のお知らせでも、本文より先に返信の入力欄が出ていて、
 * 読みたい本文が下へ押し出されていた(2026-10-12 の見直し A-7)。
 *
 * アドレスの形だけで決める — 本文やヘッダーを取りに行く前(開いた瞬間)に判定できるよう
 * にするため。外れても欄が閉じているだけで、ボタン1つで開けるので、迷う形は入れない
 * (info@ や support@ は人が返事を読んでいることが多いので、返信できる側に残す)。 */

/** ローカル部(@より前)のどこかに入っていれば送信専用とみなす語。
 * 「info-noreply」「noreply.jp」「reply-no-reply」のような付け足しにも効くよう、部分一致で見る。 */
const NO_REPLY_FRAGMENT = /no[-_.]?reply|do[-_.]?not[-_.]?reply|dont[-_.]?reply|mailer[-_.]?daemon/;

/** ローカル部がこの語そのもの(+や区切りの後ろは問わない)なら、自動のお知らせとみなす。
 * 部分一致にしないのは、「notice-tanaka@」のように人の名前と組み合わせた宛先を外すため。 */
const AUTOMATED_LOCAL_PARTS = new Set([
  "postmaster",
  "bounce",
  "bounces",
  "notification",
  "notifications",
  "notify",
  "newsletter",
  "newsletters",
  "mailmagazine",
  "mail-magazine",
  "mail_magazine",
  "magazine",
  "melmaga",
  "merumaga",
]);

/** 差出人のアドレス(`名前 <addr>` の形でもよい)から、返信しても届かない・読まれない
 * 相手かどうかを返す。 */
export function isNoReplySender(from: string): boolean {
  const address = extractAddress(from);
  const at = address.lastIndexOf("@");
  if (at <= 0) return false;
  // +より後ろ(配信ごとの印)は見ない。「noreply+abc@」も「notifications+123@」も同じ扱い。
  const local = address.slice(0, at).split("+")[0];
  const domain = address.slice(at + 1);
  if (NO_REPLY_FRAGMENT.test(local)) return true;
  if (AUTOMATED_LOCAL_PARTS.has(local)) return true;
  // 「xxx@noreply.example.com」のように、ドメインの側に送信専用と書いてある形もある。
  return domain.split(".").some((label) => NO_REPLY_FRAGMENT.test(label));
}

function extractAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  return (angled ? angled[1] : from).trim().toLowerCase();
}
