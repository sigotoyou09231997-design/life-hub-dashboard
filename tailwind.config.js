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
