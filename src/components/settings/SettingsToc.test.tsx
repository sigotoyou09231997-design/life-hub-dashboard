/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Database, PiggyBank, Sparkles } from "lucide-react";
import { SettingsSection, SettingsToc, pickActiveSection } from "./SettingsToc";

// jsdom には scrollIntoView が無いので、テストの間だけ差し込んで、終わったら元に戻す。
const originalScrollIntoView = Element.prototype.scrollIntoView;
afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe("pickActiveSection", () => {
  const sections = [
    { id: "a", top: -400 },
    { id: "b", top: 40 },
    { id: "c", top: 300 },
  ];

  it("上端が基準線より上に来た区切りのうち、いちばん下のもの", () => {
    expect(pickActiveSection(sections, 96, false)).toBe("b");
  });

  it("どれも基準線まで来ていなければ先頭(開いた直後)", () => {
    expect(pickActiveSection([{ id: "a", top: 120 }, { id: "b", top: 600 }], 96, false)).toBe("a");
  });

  it("一番下までスクロールしきったら最後(背の低い区切りは基準線まで上がって来られない)", () => {
    expect(pickActiveSection(sections, 96, true)).toBe("c");
  });

  it("区切りが無ければ null", () => {
    expect(pickActiveSection([], 96, false)).toBeNull();
  });
});

describe("SettingsToc", () => {
  const items = [
    { id: "settings-news", label: "お知らせ", icon: Sparkles },
    { id: "settings-data", label: "データ", icon: Database },
    { id: "settings-money", label: "お金", icon: PiggyBank },
  ];

  function renderPage() {
    return render(
      <div>
        <SettingsToc items={items} />
        {items.map((item) => (
          <SettingsSection key={item.id} id={item.id} label={item.label}>
            <div>{item.label}のカード</div>
          </SettingsSection>
        ))}
      </div>,
    );
  }

  it("目次の項目を押すと、その区切りへなめらかに飛び、印がそこへ移る", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPage();
    const nav = screen.getByRole("navigation", { name: "設定の目次" });
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("お知らせ");

    fireEvent.click(screen.getByRole("link", { name: "お金" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("settings-money"));
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("お金");
    // キーボードの人の次の Tab が飛んだ先から始まるよう、区切りにフォーカスを移す
    expect(document.activeElement).toBe(document.getElementById("settings-money"));
    // URL に #… を付けない(戻るボタンの履歴を増やさない)
    expect(window.location.hash).toBe("");
  });

  it("区切りは見出しの名前で読み上げられる", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "データ" }).id).toBe("settings-data");
  });
});
