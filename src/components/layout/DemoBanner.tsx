import { exitDemo, IS_DEMO } from "../../lib/demoMode";

/** デモ(src/lib/demoMode.ts)の時だけ、画面の一番上に「見本のデータで動いている」ことと、終わり方を出す。
 * 触った内容はこの端末の中のデモ用の保存先にだけ残り、本物のアカウントやサーバーには届かない。 */
export function DemoBanner() {
  if (!IS_DEMO) return null;
  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner__label">デモ</span>
      <span className="demo-banner__text">見本のデータで動いています。自由に触れます（保存はこの端末の中だけ）。</span>
      <button type="button" className="demo-banner__exit" onClick={exitDemo}>
        デモを終わる
      </button>
    </div>
  );
}
