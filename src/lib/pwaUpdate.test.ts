import { beforeEach, describe, expect, it, vi } from "vitest";

// Module-level singleton state, so each test gets its own fresh instance.
async function freshModule() {
  vi.resetModules();
  return import("./pwaUpdate");
}

describe("pwaUpdate", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("notifies subscribers when an update becomes available", async () => {
    const { markUpdateAvailable, subscribeUpdateAvailable } = await freshModule();
    const listener = vi.fn();
    subscribeUpdateAvailable(listener);
    expect(listener).not.toHaveBeenCalled();

    markUpdateAvailable();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires immediately for a subscriber joining after the update was already found", async () => {
    const { markUpdateAvailable, subscribeUpdateAvailable } = await freshModule();
    markUpdateAvailable();

    const listener = vi.fn();
    subscribeUpdateAvailable(listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a second markUpdateAvailable does not re-notify", async () => {
    const { markUpdateAvailable, subscribeUpdateAvailable } = await freshModule();
    const listener = vi.fn();
    subscribeUpdateAvailable(listener);

    markUpdateAvailable();
    markUpdateAvailable();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a listener after it unsubscribes", async () => {
    const { markUpdateAvailable, subscribeUpdateAvailable } = await freshModule();
    const listener = vi.fn();
    const unsubscribe = subscribeUpdateAvailable(listener);
    unsubscribe();

    markUpdateAvailable();
    expect(listener).not.toHaveBeenCalled();
  });

  it("applyUpdate calls the registered applier with reloadPage=true", async () => {
    const { applyUpdate, setUpdateApplier } = await freshModule();
    const applier = vi.fn().mockResolvedValue(undefined);
    setUpdateApplier(applier);

    await applyUpdate();
    expect(applier).toHaveBeenCalledWith(true);
  });

  it("applyUpdate is a no-op when no applier has been registered yet", async () => {
    const { applyUpdate } = await freshModule();
    await expect(applyUpdate()).resolves.toBeUndefined();
  });
});
