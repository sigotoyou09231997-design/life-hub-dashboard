/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EventPerson } from "../../types";
import { PersonTags } from "./PersonTags";

function person(id: string, name: string, color: string, sortOrder: number): EventPerson {
  return { id, name, color, sortOrder, createdAt: 0 };
}

const people = [person("p-me", "自分", "blue", 1), person("p-wife", "妻", "green", 2)];

afterEach(cleanup);

describe("予定に付いた「誰の予定か」の印", () => {
  it("付いている人の名前を出す", () => {
    render(<PersonTags event={{ personIds: ["p-me", "p-wife"] }} people={people} />);
    expect(screen.getByText("自分")).toBeTruthy();
    expect(screen.getByText("妻")).toBeTruthy();
  });

  it("誰も付いていない予定には何も描かない", () => {
    const { container } = render(<PersonTags event={{}} people={people} />);
    expect(container.innerHTML).toBe("");
  });

  it("消された人のidが残っていても、その人だけ黙って飛ばす", () => {
    render(<PersonTags event={{ personIds: ["p-gone", "p-wife"] }} people={people} />);
    expect(screen.queryByText("p-gone")).toBeNull();
    expect(screen.getByText("妻")).toBeTruthy();
  });

  it("残った人が1人もいなければ、空の枠だけが残らないようにする", () => {
    const { container } = render(<PersonTags event={{ personIds: ["p-gone"] }} people={people} />);
    expect(container.innerHTML).toBe("");
  });

  it("狭い所では小さい版になる", () => {
    const { container } = render(<PersonTags event={{ personIds: ["p-me"] }} people={people} compact />);
    expect(container.querySelector(".person-tags--compact")).toBeTruthy();
  });
});
