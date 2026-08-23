import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { markUpdateAvailable, setUpdateApplier } from "./lib/pwaUpdate";
import "./index.css";
import "./styles/hub.css";
import "./styles/trips.css";
import "./styles/forms.css";

// A tab left open never re-checks for updates on its own, so it kept serving a
// stale build until a full reload/reinstall. Polling registration.update()
// (here + on tab refocus) means an already-open session notices new deploys
// without any manual action. registerType: "prompt" (see vite.config.ts) means
// a found update just sits waiting here instead of reloading the tab out from
// under the user — UpdateBanner.tsx shows the banner as soon as it lands and
// applies it a moment later (holding off only while a form is open).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateAvailable();
  },
  onRegisteredSW(_swScriptUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => void registration.update();
    setInterval(checkForUpdate, 60_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
  },
});
setUpdateApplier(updateSW);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
