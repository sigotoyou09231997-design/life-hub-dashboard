import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  getBackgroundPeriod,
  getBackgroundRotationDateKey,
  selectBackground,
  type BackgroundCandidate,
} from "../../lib/backgrounds";

function routeTone(pathname: string): string {
  if (pathname.startsWith("/records/expense")) return "finance";
  if (pathname.startsWith("/schedule")) return "schedule";
  if (pathname.startsWith("/gmail")) return "gmail";
  if (pathname.startsWith("/records/notes")) return "notes";
  return pathname === "/" ? "home" : "default";
}

export function AmbientBackground() {
  const { pathname } = useLocation();
  const [clock, setClock] = useState(() => new Date());
  const [portrait, setPortrait] = useState(() => window.matchMedia("(orientation: portrait)").matches);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    const media = window.matchMedia("(orientation: portrait)");
    const handleChange = (event: MediaQueryListEvent) => setPortrait(event.matches);
    media.addEventListener("change", handleChange);
    return () => {
      window.clearInterval(timer);
      media.removeEventListener("change", handleChange);
    };
  }, []);

  const period = getBackgroundPeriod(clock);
  const rotationDateKey = getBackgroundRotationDateKey(clock);
  const selectedBackground = useMemo(
    () => selectBackground(period, portrait, clock),
    // The date key refreshes the daily rotation without reselecting each minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, portrait, rotationDateKey],
  );
  const [visibleBackground, setVisibleBackground] = useState<BackgroundCandidate>(selectedBackground);
  const [outgoingBackground, setOutgoingBackground] = useState<BackgroundCandidate | null>(null);

  useEffect(() => {
    if (selectedBackground.id === visibleBackground.id) return;
    let cancelled = false;
    let cleanupTimer: number | undefined;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setOutgoingBackground(visibleBackground);
      setVisibleBackground(selectedBackground);
      cleanupTimer = window.setTimeout(() => setOutgoingBackground(null), 2000);
    };
    image.onerror = () => {
      // Keep the last known-good scene; the UI never depends on image loading.
    };
    image.src = selectedBackground.src;
    return () => {
      cancelled = true;
      if (cleanupTimer) window.clearTimeout(cleanupTimer);
    };
    // visibleBackground is deliberately captured as the outgoing frame. The
    // effect should only run when the selected id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBackground.id]);

  useEffect(() => {
    const nextClock = new Date(clock.getTime() + 60 * 60 * 1000);
    const nextPeriod = getBackgroundPeriod(nextClock);
    const next = selectBackground(nextPeriod, portrait, nextClock);
    if (next.src === visibleBackground.src) return;
    const image = new Image();
    image.src = next.src;
  }, [visibleBackground.src, clock, portrait]);

  return (
    <div className={`ambient-background ambient-background--${routeTone(pathname)} ambient-background--${period}`} aria-hidden="true">
      {outgoingBackground && (
        <div
          className="ambient-background__image ambient-background__image--outgoing"
          style={{ backgroundImage: `url(${outgoingBackground.src})`, backgroundPosition: portrait ? outgoingBackground.mobileObjectPosition : outgoingBackground.objectPosition }}
        />
      )}
      <div
        key={visibleBackground.id}
        className="ambient-background__image"
        style={{ backgroundImage: `url(${visibleBackground.src})`, backgroundPosition: portrait ? visibleBackground.mobileObjectPosition : visibleBackground.objectPosition }}
      />
      <div className="ambient-background__wash" />
      <div className="ambient-background__light" />
      <div className="ambient-background__grain" />
    </div>
  );
}
