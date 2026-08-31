import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearShownPushNotifications, registerGmailAccountForPush, urlBase64ToUint8Array } from "./pushNotifications";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getSession: vi.fn() }));

vi.mock("./supabase", () => ({ isSupabaseConfigured: true, auth: { getSession: mocks.getSession } }));
vi.mock("./supabaseData", () => ({ getSupabaseDataClient: vi.fn(async () => ({ from: mocks.from })) }));

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

describe("registerGmailAccountForPush", () => {
  /** Stands in for supabase.from("push_subscriptions").select("id").eq(...).limit(1),
   * plus the gmail_server_accounts upsert that follows it. Returns the upsert spy. */
  function supabaseWith(subscriptionRows: { id: string }[]) {
    const upsert = vi.fn(async (_row: Record<string, unknown>, _options: { onConflict: string }) => ({ error: null }));
    mocks.from.mockImplementation((table: string) => {
      if (table === "push_subscriptions") {
        const query: Record<string, unknown> = {};
        query.select = vi.fn(() => query);
        query.eq = vi.fn(() => query);
        query.limit = vi.fn(async () => ({ data: subscriptionRows, error: null }));
        return query;
      }
      return { upsert };
    });
    return upsert;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("stores the reconnected account's new refresh token so background notifications resume", async () => {
    const upsert = supabaseWith([{ id: "sub-1" }]);

    await registerGmailAccountForPush({ email: "me@gmail.com", refreshToken: "new-token" });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", email: "me@gmail.com", refresh_token: "new-token" }),
      { onConflict: "user_id,email" },
    );
  });

  it("starts the server-side checkpoint at the reconnection, so the backlog isn't replayed as notifications", async () => {
    const upsert = supabaseWith([{ id: "sub-1" }]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));

    await registerGmailAccountForPush({ email: "me@gmail.com", refreshToken: "new-token" });

    expect(upsert.mock.calls[0][0]).toMatchObject({ last_checked_at: "2026-08-31T00:00:00.000Z" });
    vi.useRealTimers();
  });

  it("stores nothing when this user never turned background notifications on", async () => {
    const upsert = supabaseWith([]);

    await registerGmailAccountForPush({ email: "me@gmail.com", refreshToken: "new-token" });

    expect(upsert).not.toHaveBeenCalled();
  });

  it("stores nothing when there is no Supabase session to attach the token to", async () => {
    const upsert = supabaseWith([{ id: "sub-1" }]);
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    await registerGmailAccountForPush({ email: "me@gmail.com", refreshToken: "new-token" });

    expect(upsert).not.toHaveBeenCalled();
  });
});
