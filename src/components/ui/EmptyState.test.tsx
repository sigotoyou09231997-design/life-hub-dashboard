/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CheckSquare } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { EmptyIllustration, type EmptyIllustrationKind } from "./EmptyIllustration";

afterEach(cleanup);

const KINDS: EmptyIllustrationKind[] = ["tasks", "expense", "notes", "calendar", "trip", "subscription", "diary", "mail"];

describe("空の表示の線画(UI/UX 調査メモ 第4弾 B-6)", () => {
  it("illustration を渡すと、四角いアイコンの代わりに線画を出す", () => {
    const { container } = render(
      <EmptyState icon={CheckSquare} illustration="tasks" title="すっきり、やることはありません" description="何か1つ足しますか？" />,
    );
    expect(container.querySelector('svg.empty-illust[data-kind="tasks"]')).toBeTruthy();
    expect(container.querySelector(".empty-state-icon")).toBeNull();
    expect(container.querySelector(".empty-state.has-illustration")).toBeTruthy();
    expect(screen.getByText("何か1つ足しますか？")).toBeTruthy();
  });

  it("illustration が無ければ、今までどおりアイコン", () => {
    const { container } = render(<EmptyState icon={CheckSquare} title="見つかりませんでした" />);
    expect(container.querySelector(".empty-state-icon")).toBeTruthy();
    expect(container.querySelector(".empty-illust")).toBeNull();
  });

  it.each(KINDS)("%s の線画は飾りとして読み上げから外し、線の太さはアイコンと同じ 1.75", (kind) => {
    const { container } = render(<EmptyIllustration kind={kind} size={64} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
    expect(svg.getAttribute("width")).toBe("64");
    // 下敷きの丸のほかに、絵の線が入っている。
    expect(svg.querySelectorAll("path, rect, circle").length).toBeGreaterThan(2);
  });
});
