// 数据层：领域类型定义，不包含任何规则与存储实现

export type ShiftKind = "早班" | "中班" | "晚班";

/** open=当班中 pending=交接不一致待处理 closed=已关班（冻结） */
export type ShiftStatus = "open" | "pending" | "closed";

export type VersionKind = "hold" | "close" | "resolve" | "correct-pack" | "correct-redemption";

/** 纸质券包：领用 / 使用 / 作废，交班余券 = 领用 - 使用 - 作废 */
export interface CouponPack {
  received: number;
  used: number;
  voided: number;
}

/** 洗车次卡：登记车牌、总次数、有效期末，每次核销累加 used */
export interface WashCard {
  id: string;
  /** 卡号（业务编号，唯一） */
  code: string;
  /** 登记车牌（规范化大写） */
  plate: string;
  /** 总次数 */
  total: number;
  /** 已核销次数，始终与核销台账保持一致 */
  used: number;
  /** 有效期末 YYYY-MM-DD（含当日） */
  expiresOn: string;
  createdAt: string;
}

/** 单次电子核销记录（幂等：相同 requestId 只保留首次） */
export interface Redemption {
  id: string;
  cardId: string;
  cardCode: string;
  plate: string;
  shiftId: string;
  at: string;
  /** 提交令牌，重复提交按首次核销返回 */
  requestId: string;
  /** 更正撤销（关班后撤销须走带原因版本） */
  reversed?: boolean;
}

/** 待处理班的处理说明 */
export interface DiscrepancyNote {
  handler: string;
  reason: string;
  at: string;
  /** 关班时刻电子核销 - 纸质券使用 的差额 */
  diff: number;
}

export interface Shift {
  id: string;
  /** 营业日 YYYY-MM-DD */
  businessDate: string;
  kind: ShiftKind;
  openedAt: string;
  closedAt: string | null;
  opener: string;
  closer?: string;
  status: ShiftStatus;
  pack: CouponPack;
  /** 已关班但存在经处理人确认的差额说明 */
  discrepancy: DiscrepancyNote | null;
}

/** 班次冻结/更正版本：保留旧值与新值 */
export interface ShiftVersion {
  id: string;
  shiftId: string;
  kind: VersionKind;
  at: string;
  handler: string;
  reason: string;
  before: unknown;
  after: unknown;
}

export interface HandoverState {
  storageVersion: number;
  cards: WashCard[];
  shifts: Shift[];
  redemptions: Redemption[];
  versions: ShiftVersion[];
}
