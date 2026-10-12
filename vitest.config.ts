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
// 例外: 環境変数 VITEST_MAX_FORKS で数を変えられる。scripts/ship.sh が、本番に出す時の全テストだけ 4 にして
// (2個だと約110秒、5〜6個だと約65秒 — 2026-10-13 に測った。5個だと混み合って時間切れで落ちるテストが出たので4個)、同時に走る ship.sh は1つだけになるよう順番待ちさせている
// (重なって28個になるのを防ぐ。2026-10-12 の事故と同じことが起きないように)。ふだんの `npm test` は2個のまま。
const forks = Math.max(1, Number(process.env.VITEST_MAX_FORKS) || 2);
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      poolOptions: { forks: { maxForks: forks, minForks: 1 } },
      // 時間切れの上限(既定は5秒)。並列で走らせると Mac が混み、重いテスト(旅行の7日ぶん80件など。1件で約4〜5秒)や
      // 重い部品を読み込む最初のテストが、内容は正しいのに5秒を超えて落ちた(2026-10-13、続けて3回)。
      // テストの内容と、確かめる項目は変えず、上限だけ伸ばす。止まったままのテストは、15秒で落ちる。
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  })
);
