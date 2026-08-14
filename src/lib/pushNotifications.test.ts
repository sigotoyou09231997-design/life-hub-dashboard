import { afterEach, describe, expect, it, vi } from "vitest";
import { clearShownPushNotifications, urlBase64ToUint8Array } from "./pushNotifications";

describe("urlBase64ToUint8Array", () => {
  it("decodes a URL-safe base64 VAPID-style key into the matching bytes", () => {
    // "hello" base64-encoded, then made URL-safe (no +/ or padding differences to exercise here,
    // so also cover a value that needs - / _ translation below).
    const bytes = urlBase64ToUint8Array("aGVsbG8=");
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("translates - and _ back to + and / before decoding", () => {
    // Standard base64 of two bytes 0xfb 0xff is "-/8=" style content; build one containing
    // both url-safe substitution characters and no padding to mimic a real VAPID key shape.
    const standard = btoa(String.fromCharCode(0xfb, 0xff, 0xef));
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const bytes = urlBase64ToUint8Array(urlSafe);
    expect(Array.from(bytes)).toEqual([0xfb, 0xff, 0xef]);
  });

  it("adds the padding a raw VAPID public key omits", () => {
    // A 65-byte uncompressed EC public key base64url-encodes to a length that needs padding
    // back on before atob() will accept it — this is the exact case PushManager.subscribe hits.
    const original = Uint8Array.from({ length: 65 }, (_, i) => i);
    const base64 = btoa(String.fromCharCode(...original));
    const urlSafeNoPad = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(urlSafeNoPad.length % 4).not.toBe(0);
    const bytes = urlBase64ToUint8Array(urlSafeNoPad);
    expect(Array.from(bytes)).toEqual(Array.from(original));
  });
});

describe("clearShownPushNotifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when the browser has no serviceWorker support", async () => {
    vi.stubGlobal("navigator", {});
    await expect(clearShownPushNotifications()).resolves.toBeUndefined();
  });

  it("does nothing when no service worker is registered yet", async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
    await clearShownPushNotifications();
    expect(getRegistration).toHaveBeenCalled();
  });

  it("closes every currently-shown notification for this origin", async () => {
    const close1 = vi.fn();
    const close2 = vi.fn();
    const getNotifications = vi.fn().mockResolvedValue([{ close: close1 }, { close: close2 }]);
    const getRegistration = vi.fn().mockResolvedValue({ getNotifications });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

    await clearShownPushNotifications();

    expect(close1).toHaveBeenCalledOnce();
    expect(close2).toHaveBeenCalledOnce();
  });
});
