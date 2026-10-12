/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "var(--color-accent)",
          light: "var(--color-accent-light)",
        },
        navy: "var(--color-navy)",
        // 意味を持つ3色。暖色・写真ベースの新デザインの機能別の色
        // （src/styles/theme-warm.css の --tone-task / --tone-gmail）と同じ濃さに
        // 揃えてある。元は Tailwind 既定の蛍光寄りの3色で、生成りの地に置くと
        // ここだけ浮いていた（達成率のバーや「優先度 高」の赤が典型）。
        // CSS変数ではなく数値のままにしているのは、bg-success/70 のような
        // 不透明度つきの書き方を残すため（var() だと透過が効かない）。
        success: "#3F9C82",
        warning: "#CF9448",
        danger: "#DC6355",
      },
      // 文字の太さは3段（UI/UX 調査メモ 第4弾 B-2）: 本文400・見出しと強調600・大きな数字700。
      // 端末の文字はヒラギノで、iPhone には W3・W6・W7 しか無い。500 は W3 に、800 は W7 に
      // 落ちて「指定と見た目が違う」状態だったので、クラス名はそのままに中身を3段へ寄せる
      // （何百か所の font-medium などを書き換えずに済む）。font-medium は iPhone で本文と同じ
      // W3 に描かれていたので、見た目を変えないよう 400 にした。
      fontWeight: {
        thin: "400",
        extralight: "400",
        light: "400",
        normal: "400",
        medium: "400",
        semibold: "600",
        bold: "700",
        extrabold: "700",
        black: "700",
      },
      // 角丸は4段（B-3）。値は src/styles/theme-teal.css の --r-* と同じもの。
      // 小さい札＝8px（sm〜lg）、入力欄・ボタン＝14px（xl）、カード＝22px（2xl・3xl）、丸＝999px。
      borderRadius: {
        sm: "var(--r-tag)",
        DEFAULT: "var(--r-tag)",
        md: "var(--r-tag)",
        lg: "var(--r-tag)",
        xl: "var(--r-control)",
        "2xl": "var(--r-card)",
        "3xl": "var(--r-card)",
        full: "var(--r-pill)",
      },
      // 影は2段（B-4）: 置いてある物＝--shadow-rest、浮いている物（お知らせ・上の帯）＝--shadow-float。
      // 無印の `shadow` は Tailwind のまま。使っているのはスイッチのつまみだけで、小さな丸には
      // 細く締まった影が要る（CSS の .switch__knob も同じ理由で2段に入れていない）。
      boxShadow: {
        sm: "var(--shadow-rest)",
        md: "var(--shadow-rest)",
        lg: "var(--shadow-float)",
        xl: "var(--shadow-float)",
        "2xl": "var(--shadow-float)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Hiragino Sans",
          "Hiragino Kaku Gothic ProN",
          "Yu Gothic",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
