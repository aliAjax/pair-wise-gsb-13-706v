// 数据模型：次卡、核销流水、班次、券包版本、冲突
export type CardStatus = "有效" | "已用尽" | "已过期";
export type ShiftStatus = "进行中" | "待处理" | "已关班";

export interface WashCard {
  id: string; // 卡号
  plate: string; // 车牌（统一大写、去空格）
  totalTimes: number; // 总次数
  usedTimes: number; // 已核销次数
  validUntil: string; // 有效期末 YYYY-MM-DD
  createdAt: string;
}

export interface Redemption {
  id: string;
  requestKey: string; // 幂等提交键：重复提交只保留首次
  cardId: string;
  plate: string;
  shiftId: string;
  createdAt: string;
}

export interface Shift {
  id: string;
  label: string;
  status: ShiftStatus;
  openedAt: string;
  closedAt?: string;
  handler?: string; // 处理人
  handleNote?: string; // 差异处理原因
}

export interface CouponVersion {
  id: string;
  shiftId: string;
  version: number; // 1 为开班登记，关班后更正依次递增
  received: number; // 纸质券领用
  used: number; // 纸质券使用
  voided: number; // 纸质券作废
  reason: string; // 登记 / 更正原因
  createdAt: string;
}

export interface HandoverSnapshot {
  cards: WashCard[];
  redemptions: Redemption[];
  shifts: Shift[];
  couponVersions: CouponVersion[];
}

export interface ConflictCardRef {
  plate: string;
  cardId: string;
}

export interface Conflict {
  shiftId: string;
  shiftLabel: string;
  shiftStatus: ShiftStatus;
  electronic: number; // 电子核销数
  couponUsed: number; // 券包使用数
  difference: number; // 差额 = 电子核销 - 券包使用
  cards: ConflictCardRef[];
}

export interface Result {
  ok: boolean;
  message: string;
  duplicated?: boolean;
}
