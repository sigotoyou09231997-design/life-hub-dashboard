import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNotificationPayload, checkForNewMail, parseSenderEmail } from "../functions/checkGmailAndNotify";

describe("buildNotificationPayload", () => {
  it("uses the sender's display name as the title, and a labeled subject+snippet as the body", () => {
    const payload = JSON.parse(
      buildNotificationPayload(1, { from: '"田中太郎" <taro@example.com>', subject: "会議の件", snippet: "来週の会議についてご相談が..." }),
    );
    expect(payload.title).toBe("田中太郎");
    expect(payload.body).toBe("件名: 会議の件\n来週の会議についてご相談が...");
    expect(payload.url).toBe("/gmail");
  });

  it("falls back to the raw address when the From header has no display name, and omits an empty snippet line", () => {
    const payload = JSON.parse(buildNotificationPayload(1, { from: "a@example.com", subject: "テスト", snippet: "" }));
    expect(payload.title).toBe("a@example.com");
    expect(payload.body).toBe("件名: テスト");
  });

  it("appends a count of the remaining messages to the title when multiple arrived", () => {
    const payload = JSON.parse(buildNotificationPayload(3, { from: "a@example.com", subject: "件名", snippet: "本文" }));
    expect(payload.title).toBe("a@example.com 他2件");
  });

  it("falls back to a generic count-based title/empty body when the newest message's metadata couldn't be fetched", () => {
    const payload = JSON.parse(buildNotificationPayload(2, null));
    expect(payload.title).toBe("新着メール 2件");
    expect(payload.body).toBe("");
  });
});

describe("parseSenderEmail", () => {
  it("extracts and lowercases the address from a display-name From header", () => {
    expect(parseSenderEmail('"田中太郎" <Taro@Example.com>')).toBe("taro@example.com");
  });

  it("lowercases a bare address with no display name", () => {
    expect(parseSenderEmail("A@Example.com")).toBe("a@example.com");
  });
});

describe("checkForNewMail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function messageMetaResponse(internalDate: number, from: string, subject: string) {
    return {
      ok: true,
      json: async () => ({
        snippet: `snippet for ${subject}`,
        internalDate: String(internalDate),
        payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
      }),
    };
  }

  it("drops a message the after: query still returned even though its internalDate is at/before the checkpoint", async () => {
    // Gmail's after: search operator isn't reliably second-precise, so it can resurface a
    // message received before sinceEpochSec (see the comment on checkForNewMail) — this is
    // exactly what previously caused "new mail" push notifications with nothing actually new.
    const sinceEpochSec = 1_700_000_000;
    const sinceEpochMs = sinceEpochSec * 1000;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/messages?")) {
        return { ok: true, json: async () => ({ messages: [{ id: "new1" }, { id: "stale1" }] }) };
      }
      if (url.includes("/messages/new1")) {
        return messageMetaResponse(sinceEpochMs + 5_000, "a@example.com", "New mail");
      }
      if (url.includes("/messages/stale1")) {
        return messageMetaResponse(sinceEpochMs - 5_000, "b@example.com", "Already seen");
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkForNewMail("token", sinceEpochSec, new Set());

    expect(result.count).toBe(1);
    expect(result.latest?.subject).toBe("New mail");
  });

  it("returns no new mail when the only candidate is stale", async () => {
    const sinceEpochSec = 1_700_000_000;
    const sinceEpochMs = sinceEpochSec * 1000;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/messages?")) {
        return { ok: true, json: async () => ({ messages: [{ id: "stale1" }] }) };
      }
      return messageMetaResponse(sinceEpochMs - 1_000, "b@example.com", "Already seen");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkForNewMail("token", sinceEpochSec, new Set());

    expect(result.count).toBe(0);
    expect(result.latest).toBeNull();
  });
});
