import { latestChangelogId } from "./changelog";

/** どこまで読んだかは端末ごと。同期する必要が無く(読んだかどうかは端末の話)、
 * 保存先を増やさずに済むので localStorage に置く。 */
const SEEN_KEY = "lifeHubChangelogSeen";

export function getSeenChangelogId(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    // プライベートブラウズなどで読めないときは「一度も見ていない」として扱う。
    return null;
  }
}

/** 更新履歴の画面を開いたときに呼ぶ。いちばん新しいお知らせまで読んだ印を付ける。 */
export function markChangelogSeen(): void {
  const latest = latestChangelogId();
  if (!latest) return;
  try {
    localStorage.setItem(SEEN_KEY, latest);
  } catch {
    // 覚えられなくても画面は動く(次に開いたときにまた新着として出るだけ)。
  }
}
