// 规则层：纸质券包与交接一致性规则
import type { CouponPack, Redemption, Shift } from "../data/types";
import { fail, ok, type Outcome } from "./result";

export function packBalance(pack: CouponPack): number {
  return pack.received - pack.used - pack.voided;
}

/** 券包数字登记：非负整数，且 使用+作废 不得超过领用 */
export function validatePack(pack: CouponPack): Outcome<CouponPack> {
  const { received, used, voided } = pack;
  for (const [label, v] of [
    ["领用", received],
    ["使用", used],
    ["作废", voided]
  ] as const) {
    if (!Number.isInteger(v) || v < 0) return fail(`${label}数量须为非负整数`);
  }
  if (used + voided > received) return fail("使用与作废合计超过领用，余券将为负");
  return ok(pack);
}

/**
 * 交接一致性：本班电子核销次数（不含更正撤销）应与纸质券使用张数一致。
 * 不一致时整班进入 pending（待处理），不得关班。
 */
export function electronicCount(shiftId: string, redemptions: readonly Redemption[]): number {
  return redemptions.filter((r) => r.shiftId === shiftId && !r.reversed).length;
}

export function handoverDiff(shift: Shift, redemptions: readonly Redemption[]): number {
  return electronicCount(shift.id, redemptions) - shift.pack.used;
}

export function isConsistent(shift: Shift, redemptions: readonly Redemption[]): boolean {
  return handoverDiff(shift, redemptions) === 0;
}
