// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const touched = vi.hoisted(() => ({ tables: [] as string[] }));

// どの表に触ったかだけを記録する。招かれて参加している旅行の削除は、どの表にも触れてはいけない。
vi.mock("../db/schema", () => ({
  db: new Proxy(
    {},
    {
      get: (_target, name: string) => {
        touched.tables.push(name);
        const chain: Record<string, unknown> = {
          where: () => chain,
          equals: () => chain,
          toArray: async () => [],
          delete: async () => undefined,
        };
        return chain;
      },
    },
  ),
}));
vi.mock("../lib/attachments", () => ({ deleteAttachmentsForAll: async () => undefined }));
vi.mock("../lib/currency", () => ({ deleteCurrencyFor: async () => undefined }));
vi.mock("../lib/tripShare", () => ({ endTripShare: async () => undefined }));

import { writeSharedOwners } from "../lib/sharedTrips";
import { deleteTripCascade } from "./TripsPage";

describe("deleteTripCascade", () => {
  beforeEach(() => {
    localStorage.clear();
    touched.tables = [];
  });

  it("招かれて参加している旅行は消せない(持ち主と、ほかの参加者の旅行まで消えるため)。どの表にも触れない", async () => {
    writeSharedOwners(new Map([["shared", "owner"]]));
    await deleteTripCascade("shared");
    expect(touched.tables).toEqual([]);
  });

  it("自分の旅行は、いつもどおり消す", async () => {
    await deleteTripCascade("mine");
    expect(touched.tables).toContain("trips");
    expect(touched.tables).toContain("tripSchedule");
  });
});
