import { Check } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { ACCENT_PRESETS } from "../../lib/accentColors";

/** The only control in Settings' 外観 group — swatch selection writes straight
 * to settings.accentColor, and App.tsx applies it to --color-accent/-light on
 * every load. No theme/font-size toggles here since neither is implemented. */
export function AccentColorPicker() {
  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const current = settings?.accentColor ?? ACCENT_PRESETS[0].value;

  async function handlePick(value: string) {
    if (!settings?.id) return;
    await db.settings.update(settings.id, { accentColor: value });
  }

  return (
    <div className="flex items-center gap-2.5">
      {ACCENT_PRESETS.map((preset) => {
        const selected = preset.value === current;
        return (
          <button
            key={preset.value}
            type="button"
            onClick={() => handlePick(preset.value)}
            aria-label={preset.label}
            aria-pressed={selected}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent/50"
            style={{ backgroundColor: preset.value }}
          >
            {selected && <Check size={15} strokeWidth={3} className="text-white" />}
          </button>
        );
      })}
    </div>
  );
}
