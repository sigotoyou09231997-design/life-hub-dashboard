import type { TripExpense } from "../types";

/**
 * 旅行の参加者(Trip.members、名前の配列。supabase/sql/030)と、誰が払ったか(TripExpense.paidBy)。
 * 2026-10-11、要望の受信箱「この旅行に参加してる人を入れてほしい。予定ごとに金額を入れられるようにして。
 * 誰が払ったかも入れられるようにして」から。
 *
 * 名前で持つ(人の表は作らない)。同じ旅行の中で名前が重ならなければ足りるため。
 */
export const MAX_MEMBERS = 20;
export const MAX_MEMBER_NAME = 20;

/** 前後の空白を落とし、空・重なり・長すぎるものを除く(入れた順は保つ)。 */
export function normalizeMembers(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.normalize("NFKC").trim().slice(0, MAX_MEMBER_NAME);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
    if (result.length >= MAX_MEMBERS) break;
  }
  return result;
}

export interface MemberBalance {
  name: string;
  /** その人が払った合計。 */
  paid: number;
  /** 割り勘にした時に、その人が持つ分。 */
  share: number;
  /** paid - share。プラスなら受け取る側、マイナスなら払う側。 */
  balance: number;
}

export interface SplitSummary {
  /** 割る額(誰が払ったか決まっている費用の合計)。 */
  total: number;
  /** 1人あたり(参加者で割った額)。 */
  perPerson: number;
  members: MemberBalance[];
  /** 誰が払ったか決まっていない(または参加者にいない名前の)費用の合計。割り勘には入れない。 */
  unassigned: number;
}

export interface Settlement {
  from: string;
  to: string;
  /** 円(整数)。 */
  amount: number;
}

/**
 * 割り勘の精算の仕方(2026-10-14、要望「支払いのところに割り勘タブがほしい」)。
 * 払う側(差額がマイナス)の人が、受け取る側(プラス)の人へ、誰に・いくら渡せば全員の差額が0になるかを、
 * なるべく少ない回数で返す(払う額が大きい人から、受け取る額が大きい人へ順に)。
 * 円に丸めた差額で数える。丸めて合計が0からずれた分(1〜数円)は、いちばん差額の大きい人に寄せて、必ず全員が0になるようにする。
 */
export function settlementTransfers(split: SplitSummary): Settlement[] {
  const balances = split.members.map((member) => ({ name: member.name, balance: Math.round(member.balance) }));
  const drift = balances.reduce((sum, member) => sum + member.balance, 0);
  if (drift !== 0 && balances.length > 0) {
    const biggest = balances.reduce((best, member) => (Math.abs(member.balance) > Math.abs(best.balance) ? member : best), balances[0]);
    biggest.balance -= drift;
  }
  const debtors = balances.filter((member) => member.balance < 0).map((member) => ({ ...member, balance: -member.balance }));
  const creditors = balances.filter((member) => member.balance > 0).map((member) => ({ ...member }));
  debtors.sort((a, b) => b.balance - a.balance);
  creditors.sort((a, b) => b.balance - a.balance);
  const transfers: Settlement[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].balance, creditors[c].balance);
    if (amount > 0) transfers.push({ from: debtors[d].name, to: creditors[c].name, amount });
    debtors[d].balance -= amount;
    creditors[c].balance -= amount;
    if (debtors[d].balance === 0) d += 1;
    if (creditors[c].balance === 0) c += 1;
  }
  return transfers;
}

/**
 * 費用を参加者で割り勘にした時の、払った額と差額。参加者が2人未満なら null(割る相手がいない)。
 * 割るのは誰が払ったか決まっている費用だけ。決まっていない費用まで入れると、まだ誰も立て替えていない額を
 * 全員が「払う」側になって、受け取る人のいない精算になるため(2026-10-11、画面で確かめて直した)。
 * そのため差額(balance)は全員分を足すと 0 になる。
 */
export function splitExpenses(expenses: TripExpense[], members: string[] | undefined): SplitSummary | null {
  const names = normalizeMembers(members ?? []);
  if (names.length < 2) return null;
  const paidBy = new Map(names.map((name) => [name, 0]));
  let total = 0;
  let unassigned = 0;
  for (const expense of expenses) {
    if (expense.paidBy && paidBy.has(expense.paidBy)) {
      paidBy.set(expense.paidBy, paidBy.get(expense.paidBy)! + expense.amount);
      total += expense.amount;
    } else {
      unassigned += expense.amount;
    }
  }
  const perPerson = total / names.length;
  return {
    total,
    perPerson,
    unassigned,
    members: names.map((name) => {
      const paid = paidBy.get(name)!;
      return { name, paid, share: perPerson, balance: paid - perPerson };
    }),
  };
}
