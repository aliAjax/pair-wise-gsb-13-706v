// 业务规则：纯函数，不依赖存储与页面
import type {
  CardStatus,
  Conflict,
  CouponVersion,
  Redemption,
  Shift,
  WashCard,
} from "./types";

export function todayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/\s+/g, "");
}

export function cardStatus(
  card: Pick<WashCard, "usedTimes" | "totalTimes" | "validUntil">,
  today: string = todayStr()
): CardStatus {
  if (card.usedTimes >= card.totalTimes) return "已用尽";
  if (card.validUntil < today) return "已过期";
  return "有效";
}

export function remainingTimes(card: Pick<WashCard, "usedTimes" | "totalTimes">): number {
  return Math.max(0, card.totalTimes - card.usedTimes);
}

/** 次卡登记校验：同车牌只能有一张有效卡 */
export function validateNewCard(
  cards: WashCard[],
  plate: string,
  totalTimes: number,
  validUntil: string,
  today: string = todayStr()
): string | null {
  if (!plate) return "请填写车牌号";
  if (!Number.isInteger(totalTimes) || totalTimes <= 0) return "总次数必须是正整数";
  if (!validUntil) return "请选择有效期末";
  if (validUntil < today) return "有效期末不能早于今天";
  const duplicated = cards.some(
    (card) => normalizePlate(card.plate) === plate && cardStatus(card, today) === "有效"
  );
  if (duplicated) return `车牌 ${plate} 已存在一张有效次卡，同车牌只能有一张有效卡`;
  return null;
}

export interface RedemptionCheck {
  card?: WashCard;
  plate: string;
  shift?: Shift;
  today?: string;
}

/** 核销校验：过期、次数用尽、车牌不符均拒绝 */
export function validateRedemption({
  card,
  plate,
  shift,
  today = todayStr(),
}: RedemptionCheck): string | null {
  if (!shift) return "当前没有进行中的班次，请先开班再核销";
  if (!card) return "次卡不存在，请确认卡号";
  if (normalizePlate(plate) !== normalizePlate(card.plate)) {
    return `车牌不符：该卡登记车牌为 ${card.plate}，拒绝核销`;
  }
  if (card.validUntil < today) return `次卡已于 ${card.validUntil} 过期，拒绝核销`;
  if (card.usedTimes >= card.totalTimes) return "次卡次数已用尽，拒绝核销";
  return null;
}

/** 券包数量校验：非负整数，且余券不能为负 */
export function validateCouponNumbers(received: number, used: number, voided: number): string | null {
  const entries: Array<[string, number]> = [
    ["领用", received],
    ["使用", used],
    ["作废", voided],
  ];
  for (const [label, value] of entries) {
    if (!Number.isInteger(value) || value < 0) return `纸质券${label}数量必须是非负整数`;
  }
  if (used + voided > received) return "使用与作废之和不能超过领用，交班余券不能为负";
  return null;
}

/** 交班余券 = 领用 - 使用 - 作废 */
export function remainingCoupons(
  version: Pick<CouponVersion, "received" | "used" | "voided">
): number {
  return version.received - version.used - version.voided;
}

export function latestVersion(versions: CouponVersion[], shiftId: string): CouponVersion | undefined {
  let latest: CouponVersion | undefined;
  for (const version of versions) {
    if (version.shiftId === shiftId && (!latest || version.version > latest.version)) {
      latest = version;
    }
  }
  return latest;
}

export function versionsOf(versions: CouponVersion[], shiftId: string): CouponVersion[] {
  return versions.filter((v) => v.shiftId === shiftId).sort((a, b) => a.version - b.version);
}

export function electronicCount(redemptions: Redemption[], shiftId: string): number {
  return redemptions.filter((record) => record.shiftId === shiftId).length;
}

/** 差额 = 电子核销数 - 券包使用数（按最新版本） */
export function shiftDifference(
  versions: CouponVersion[],
  redemptions: Redemption[],
  shiftId: string
): number {
  const version = latestVersion(versions, shiftId);
  return electronicCount(redemptions, shiftId) - (version?.used ?? 0);
}

/**
 * 冲突清单：已停（待处理/已关班）班次中，电子核销与券包使用不一致的班次，
 * 列出涉及的车牌、卡号、班次与差额。进行中的班次差异属正常在途，不计冲突。
 */
export function buildConflicts(
  shifts: Shift[],
  versions: CouponVersion[],
  redemptions: Redemption[]
): Conflict[] {
  return shifts
    .filter((shift) => shift.status !== "进行中")
    .flatMap((shift) => {
      const version = latestVersion(versions, shift.id);
      if (!version) return [];
      const electronic = electronicCount(redemptions, shift.id);
      const difference = electronic - version.used;
      if (difference === 0) return [];
      const seen = new Set<string>();
      const cards: Conflict["cards"] = [];
      for (const record of redemptions) {
        if (record.shiftId !== shift.id) continue;
        const key = `${record.cardId}|${record.plate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({ plate: record.plate, cardId: record.cardId });
      }
      return [
        {
          shiftId: shift.id,
          shiftLabel: shift.label,
          shiftStatus: shift.status,
          electronic,
          couponUsed: version.used,
          difference,
          cards,
        },
      ];
    })
    .sort((a, b) =>
      a.shiftStatus === b.shiftStatus ? 0 : a.shiftStatus === "待处理" ? -1 : 1
    );
}
