import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic } from "./haptics";

describe("haptic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("振動できる端末(Android)では短く振動させる", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    haptic("light");
    haptic("success");
    expect(vibrate).toHaveBeenNthCalledWith(1, 15);
    expect(vibrate).toHaveBeenNthCalledWith(2, [12, 60, 18]);
  });

  it("振動の仕組みが無い端末(iPhone)では何もしない", () => {
    vi.stubGlobal("navigator", {});
    expect(() => haptic("success")).not.toThrow();
  });

  it("ブラウザが振動を許さない場面でも止まらない", () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("NotAllowedError");
      },
    });
    expect(() => haptic()).not.toThrow();
  });
});
