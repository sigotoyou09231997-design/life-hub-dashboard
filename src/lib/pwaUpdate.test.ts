import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  describe("updateToLatestNow(設定の「最新版にする」)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("公開されている版がいま動いている版と同じなら、何もせず latest を返す", async () => {
      const mod = await import("./pwaUpdate");
      vi.stubGlobal("__APP_COMMIT__", "abcdef1234567890");
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ version: "abcdef1234567890aaaa" }) })));
      expect(mod.currentVersion()).toBe("abcdef1");
      expect(await mod.updateToLatestNow()).toBe("latest");
    });

    it("版が違えば、確かめて切り替えに入る(updating)", async () => {
      vi.resetModules();
      const mod = await import("./pwaUpdate");
      const applier = vi.fn(async () => {});
      const checker = vi.fn(async () => {});
      mod.setUpdateApplier(applier);
      mod.setUpdateChecker(checker);
      vi.stubGlobal("__APP_COMMIT__", "abcdef1234567890");
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ version: "1111111222222" }) })));
      expect(await mod.updateToLatestNow()).toBe("updating");
      expect(checker).toHaveBeenCalledTimes(1);
      expect(applier).toHaveBeenCalledWith(true);
    });

    it("公開されている版を読めなければ、unknown を返して何もしない", async () => {
      vi.resetModules();
      const mod = await import("./pwaUpdate");
      const applier = vi.fn(async () => {});
      mod.setUpdateApplier(applier);
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("offline");
      }));
      expect(await mod.updateToLatestNow()).toBe("unknown");
      expect(applier).not.toHaveBeenCalled();
    });
  });
});
