export interface AccentPreset {
  value: string;
  light: string;
  label: string;
}

/** Swatch presets, not a free color picker — each pairs a base accent with a
 * pre-tuned light tint so `--color-accent-light` never needs runtime color
 * math (color-mix() isn't safe to rely on across this app's target browsers). */
export const ACCENT_PRESETS: AccentPreset[] = [
  { value: "#2563eb", light: "#eff6ff", label: "ブルー" },
  { value: "#16a34a", light: "#f0fdf4", label: "グリーン" },
  { value: "#ea580c", light: "#fff7ed", label: "オレンジ" },
  { value: "#7c3aed", light: "#f5f3ff", label: "パープル" },
  { value: "#dc2626", light: "#fef2f2", label: "レッド" },
  { value: "#0d9488", light: "#f0fdfa", label: "ティール" },
];

export function resolveAccentPreset(accentColor: string | undefined): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.value === accentColor) ?? ACCENT_PRESETS[0];
}
