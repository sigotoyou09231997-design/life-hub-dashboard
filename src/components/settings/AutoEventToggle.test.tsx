/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../ui/ToastProvider";

const mocks = vi.hoisted(() => ({
  settings: { id: "s1" } as { id: string; autoEventEnabled?: boolean },
  updates: [] as Record<string, unknown>[],
}));

vi.mock("dexie-react-hooks", async () => {
  const { useEffect, useState } = await import("react");
  return {
    // 値の読み取りを1回だけやって返す、最小の差し替え。更新後は update が mocks.settings を書き換えるので、
    // 画面は「読み直し」の代わりに再描画で追いつく。
    useLiveQuery: (query: () => Promise<unknown>) => {
      const [value, setValue] = useState<unknown>(undefined);
      useEffect(() => {
        void query().then((v) => setValue({ ...(v as object) }));
        const id = setInterval(() => void query().then((v) => setValue({ ...(v as object) })), 10);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return value;
    },
  };
});

vi.mock("../../db/schema", () => ({
  db: {
    settings: {
      toCollection: () => ({ first: async () => mocks.settings }),
      update: async (_id: string, changes: Record<string, unknown>) => {
        mocks.updates.push(changes);
        Object.assign(mocks.settings, changes);
        return 1;
      },
    },
  },
}));

import { AutoEventToggle } from "./AutoEventToggle";

beforeEach(() => {
  mocks.settings = { id: "s1" };
  mocks.updates = [];
});
afterEach(cleanup);

function renderToggle() {
  return render(
    <ToastProvider>
      <AutoEventToggle />
    </ToastProvider>,
  );
}

describe("確定した予定を自動で入れる(設定)", () => {
  it("未設定はON。押すと止まり、もう一度押すと戻る", async () => {
    const user = userEvent.setup();
    renderToggle();
    const toggle = await screen.findByRole("button", { name: "確定した予定の自動入力を切り替え" });
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));

    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
    expect(mocks.updates).toEqual([{ autoEventEnabled: false }]);

    await user.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));
    expect(mocks.updates).toEqual([{ autoEventEnabled: false }, { autoEventEnabled: true }]);
  });

  it("何を入れるか(日時が決まったと書かれたメール・元メールのリンク)を画面で説明する", async () => {
    renderToggle();
    expect(await screen.findByText(/日時が決まったと書かれたメール/)).toBeTruthy();
    expect(screen.getByText(/元のメールへのリンクが付きます/)).toBeTruthy();
  });
});
