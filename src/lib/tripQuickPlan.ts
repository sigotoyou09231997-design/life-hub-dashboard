import type {
  TripExpense,
  TripExpenseCategory,
  TripRoutePlace,
  TripScheduleItem,
  TripScheduleType,
} from "../types";
import { routeKey, toExpenseCategory } from "./mailPlanImport";

/**
 * 「まとめて入力」1件ぶんの入力。
 *
 * 日程・費用・ルートは、実際には同じ1つの出来事(「10:00 五稜郭 1200円」)を3つの
 * 表から見ているだけなのに、これまでは3つのフォームに同じことを3回打ち込む必要が
 * あった。ここは1回の入力からその3つを起こすための形で、費用とルートは要るときだけ
 * 入り(withExpense / withRoute)、要らなければ今まで通り日程だけが増える。
 */
export interface TripQuickPlanInput {
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  title: string;
  location?: string;
  memo?: string;
  type: TripScheduleType;

  /** 費用にも入れるか。 */
  withExpense: boolean;
  amount?: number;
  /** 費用の分類。省略すると日程の種類から読み替える(観光→観光、移動→交通…)。 */
  expenseCategory?: TripExpenseCategory;
  paid?: boolean;

  /** ルートにも入れるか。 */
  withRoute: boolean;
  /** 空ならタイトルをそのまま場所の名前にする。 */
  routeName?: string;
  /** 空なら「場所」をそのまま地図に渡す文字列にする。 */
  routeAddress?: string;
}

export interface TripQuickPlanContext {
  tripId: string;
  now: number;
  /** ルートの末尾に足すための順番(src/lib/mailPlanImport.ts の nextRouteSortOrder)。 */
  nextSortOrder: number;
  /** すでにルートに入っている場所の鍵。同じ場所を二重に並べないために見る。 */
  existingRouteKeys?: Set<string>;
}

export interface TripQuickPlanRecords {
  schedule: TripScheduleItem;
  expense?: TripExpense;
  route?: TripRoutePlace;
  /** ルートに入れる指定だったが、同じ場所がもう入っていたので足さなかった。 */
  routeSkipped: boolean;
}

/** ルートに渡す場所の名前・住所を決める。どちらも空欄なら上の入力を引き継ぐ。 */
export function resolveRouteFields(input: TripQuickPlanInput): { name: string; address: string } {
  return {
    name: (input.routeName?.trim() || input.title.trim()),
    address: (input.routeAddress?.trim() || input.location?.trim() || ""),
  };
}

export interface TripQuickPlanErrors {
  title?: string;
  amount?: string;
  routeAddress?: string;
}

/** 保存できない理由を項目ごとに返す。1つも無ければ保存してよい。
 *
 * 費用とルートは入れる指定のときだけ見る — 使わない欄の不足で保存が止まると、
 * どこが悪いのか画面から分からなくなる。 */
export function validateTripQuickPlan(input: TripQuickPlanInput): TripQuickPlanErrors {
  const errors: TripQuickPlanErrors = {};
  if (!input.title.trim()) errors.title = "タイトルを入れてください";
  if (input.withExpense && !(input.amount && input.amount > 0)) errors.amount = "金額を入れてください";
  if (input.withRoute && !resolveRouteFields(input).address) {
    errors.routeAddress = "地図に渡す住所か施設名を入れてください";
  }
  return errors;
}

export function hasTripQuickPlanError(errors: TripQuickPlanErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * 入力1件から、保存する行をまとめて起こす。
 *
 * 費用の支払日と、ルートの「何日目に回るか」は日程の日付をそのまま引き継ぐ —
 * まとめて入れる意味は、同じ日付・同じ場所を3回打たなくて済むところにあるため。
 */
export function buildTripQuickPlanRecords(
  input: TripQuickPlanInput,
  ctx: TripQuickPlanContext,
): TripQuickPlanRecords {
  const title = input.title.trim();
  const location = input.location?.trim() || undefined;
  const memo = input.memo?.trim() || undefined;

  const schedule: TripScheduleItem = {
    tripId: ctx.tripId,
    date: input.date,
    startTime: input.startTime || undefined,
    endTime: input.endTime || undefined,
    title,
    location,
    memo,
    type: input.type,
    createdAt: ctx.now,
  };

  const expense: TripExpense | undefined =
    input.withExpense && input.amount && input.amount > 0
      ? {
          tripId: ctx.tripId,
          title,
          amount: input.amount,
          category: input.expenseCategory ?? toExpenseCategory(input.type),
          paidDate: input.date,
          paid: input.paid ?? false,
          memo,
          createdAt: ctx.now,
        }
      : undefined;

  const { name, address } = resolveRouteFields(input);
  const duplicated = Boolean(address) && (ctx.existingRouteKeys?.has(routeKey(address)) ?? false);
  const route: TripRoutePlace | undefined =
    input.withRoute && address && !duplicated
      ? {
          tripId: ctx.tripId,
          name,
          address,
          sortOrder: ctx.nextSortOrder,
          date: input.date || undefined,
          memo,
          visited: false,
          createdAt: ctx.now,
        }
      : undefined;

  return { schedule, expense, route, routeSkipped: input.withRoute && duplicated };
}

/** 入れ終わった知らせ(「日程・費用・ルートに入れました」)。 */
export function describeTripQuickPlanSaved(records: TripQuickPlanRecords): string {
  const parts = ["日程"];
  if (records.expense) parts.push("費用");
  if (records.route) parts.push("ルート");
  const head = `${parts.join("・")}に入れました`;
  return records.routeSkipped ? `${head}(その場所はルートにもう入っています)` : head;
}
