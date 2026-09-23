// 存储层：localStorage 读写与刷新后的一致性对账
import type { HandoverState, Redemption, Shift, ShiftVersion, WashCard } from "../data/types";
import { buildSeedState } from "../data/seed";

export const STORAGE_KEY = "car-wash-handover-v1";

/** 刷新后对账发现的冲突，列表需呈现：车牌、卡号、班次与差额 */
export interface Conflict {
  plate: string;
  cardCode: string;
  shiftLabel: string;
  /** 卡台账次数 - 核销台账次数；非零即冲突 */
  cardLedgerDelta: number;
  /** 电子核销次数 - 纸质券使用张数；非零即交接冲突 */
  handoverDelta: number;
}

function isStateLike(raw: unknown): raw is HandoverState {
  return (
    !!raw &&
    typeof raw === "object" &&
    Array.isArray((raw as HandoverState).cards) &&
    Array.isArray((raw as HandoverState).shifts) &&
    Array.isArray((raw as HandoverState).redemptions) &&
    Array.isArray((raw as HandoverState).versions)
  );
}

export function loadState(): HandoverState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return buildSeedState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isStateLike(parsed)) return buildSeedState();
    return parsed;
  } catch {
    return buildSeedState();
  }
}

export function saveState(state: HandoverState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function shiftLabel(shift: Shift): string {
  return `${shift.businessDate} ${shift.kind}`;
}

/**
 * 刷新后对账：
 * 1. 次卡 used 必须等于其在全部未撤销核销中的出现次数；
 * 2. 已关班/待处理班的电子核销数与纸质券使用数差额须有记录；
 *    （open 班允许暂时不等，关班时才强制一致或转待处理）
 */
export function reconcile(state: HandoverState): Conflict[] {
  const conflicts: Conflict[] = [];
  const { cards, shifts, redemptions } = state;

  const live = redemptions.filter((r) => !r.reversed);
  const countByCard = new Map<string, number>();
  const countByShift = new Map<string, number>();
  for (const r of live) {
    countByCard.set(r.cardId, (countByCard.get(r.cardId) ?? 0) + 1);
    countByShift.set(r.shiftId, (countByShift.get(r.shiftId) ?? 0) + 1);
  }

  for (const card of cards) {
    const ledger = countByCard.get(card.id) ?? 0;
    const cardLedgerDelta = card.used - ledger;
    // 次卡台账与核销台账不一致：只报一条（车牌、卡号），班次取该卡最近关联班次
    if (cardLedgerDelta !== 0) {
      const touchedShift = live
        .filter((r) => r.cardId === card.id)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((r) => shifts.find((s) => s.id === r.shiftId))
        .find(Boolean);
      conflicts.push({
        plate: card.plate,
        cardCode: card.code,
        shiftLabel: touchedShift ? shiftLabel(touchedShift) : "无关联班次",
        cardLedgerDelta,
        handoverDelta: 0
      });
    }
    // 交接差额：该卡在已关班/待处理班的核销数与纸质券使用不符且无处理说明
    const shiftIds = new Set(live.filter((r) => r.cardId === card.id).map((r) => r.shiftId));
    for (const shift of shifts) {
      if (shift.status === "open" || shift.discrepancy || !shiftIds.has(shift.id)) continue;
      const handoverDelta = (countByShift.get(shift.id) ?? 0) - shift.pack.used;
      if (handoverDelta !== 0) {
        conflicts.push({
          plate: card.plate,
          cardCode: card.code,
          shiftLabel: shiftLabel(shift),
          cardLedgerDelta: 0,
          handoverDelta
        });
      }
    }
  }

  // 券包使用超过电子核销但无次卡关联（如纯券洗车），按班次单独列冲突
  for (const shift of shifts) {
    if (shift.status === "open") continue;
    const electronic = countByShift.get(shift.id) ?? 0;
    const handoverDelta = electronic - shift.pack.used;
    if (handoverDelta !== 0 && !shift.discrepancy) {
      const exists = conflicts.some((c) => c.shiftLabel === shiftLabel(shift) && c.handoverDelta === handoverDelta);
      if (!exists) {
        conflicts.push({ plate: "—", cardCode: "—", shiftLabel: shiftLabel(shift), cardLedgerDelta: 0, handoverDelta });
      }
    }
  }

  return conflicts;
}

export type { HandoverState, Shift, WashCard, Redemption, ShiftVersion };
