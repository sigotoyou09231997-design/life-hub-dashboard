import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// テスト専用の設定。本体（vite.config.ts）の設定はそのまま引き継ぎ、テストの同時実行数だけを足す
// （vite.config.ts に直接足さないのは、Vitest が内蔵する Vite(5系) と本体の Vite(6系) の型が合わず、
//  `tsc --noEmit` が通らなくなるため。このファイルは tsconfig の検査対象に入っておらず、`vite build` も読まない）。
//
// テストの同時実行数。Vitest は既定で CPU のコア数−1（8コアの Mac なら7）個の作業用プロセスで走る。
// 複数の作業（会話・ブランチ）が同時にテストを走らせると、28個ほどが8コアを奪い合って Mac 全体が止まった
// （2026-10-12、負荷平均が300を超え、メモリ切れで同じ Mac で動く自動投稿まで遅れた）。
// 2個に絞る。1回の実行は遅くなるが、重なっても詰まらない。`npm test` でも `npx vitest run` でも効く。
//
// 例外: 環境変数 VITEST_MAX_FORKS で数を変えられる。scripts/ship.sh が、本番に出す時の全テストだけ 5 にして
// (2個だと約110秒、6個だと約70秒 — 2026-10-13 に測った)、同時に走る ship.sh は1つだけになるよう順番待ちさせている
// (重なって28個になるのを防ぐ。2026-10-12 の事故と同じことが起きないように)。ふだんの `npm test` は2個のまま。
const forks = Math.max(1, Number(process.env.VITEST_MAX_FORKS) || 2);
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { poolOptions: { forks: { maxForks: forks, minForks: 1 } } },
  })
);
