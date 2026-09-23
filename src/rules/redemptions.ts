// 规则层：电子核销规则（幂等；过期、次数用尽、车牌不符一律拒绝）
import type { Redemption, Shift, WashCard } from "../data/types";
import { fail, ok, type Outcome } from "./result";
import { isExpired, isUsedUp, normalizePlate, toDateStr } from "./plates";

export interface RedeemInput {
  /** 操作员输入的车牌，必须与卡登记车牌一致 */
  plate: string;
  /** 卡号或卡 ID 均可，由页面解析 */
  cardId?: string;
  cardCode?: string;
  requestId: string;
}

export interface RedeemResult {
  redemption: Redemption;
  card: WashCard;
  /** true 表示命中幂等：重复提交，只保留并返回首次核销 */
  duplicate: boolean;
}

function findCard(cards: readonly WashCard[], input: RedeemInput): WashCard | undefined {
  return cards.find((c) => c.id === input.cardId || c.code === input.cardCode?.trim());
}

export function planRedemption(
  input: RedeemInput,
  cards: readonly WashCard[],
  redemptions: readonly Redemption[],
  shift: Shift,
  now = new Date(),
  today = toDateStr()
): Outcome<RedeemResult> {
  if (shift.status === "closed") return fail("该班次已关班，核销已冻结");
  if (shift.status === "pending") return fail("交接存在差额待处理，本班核销暂停");
  if (!input.requestId) return fail("缺少提交令牌");

  // 幂等：相同 requestId 的重复提交只保留首次
  const first = redemptions.find((r) => r.requestId === input.requestId);
  if (first) {
    const card = cards.find((c) => c.id === first.cardId);
    if (!card) return fail("首次核销对应的次卡不存在");
    return ok({ redemption: first, card, duplicate: true });
  }

  const card = findCard(cards, input);
  if (!card) return fail("次卡不存在");

  const plate = normalizePlate(input.plate);
  if (plate !== card.plate) {
    return fail(`车牌不符：输入 ${plate || "（空）"}，登记车牌为 ${card.plate}`);
  }
  if (isExpired(card, today)) return fail(`卡 ${card.code} 已过期（有效期末 ${card.expiresOn}），拒绝核销`);
  if (isUsedUp(card)) return fail(`卡 ${card.code} 次数已用尽，拒绝核销`);

  const redemption: Redemption = {
    id: `rd-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    cardId: card.id,
    cardCode: card.code,
    plate: card.plate,
    shiftId: shift.id,
    at: now.toISOString(),
    requestId: input.requestId
  };

  return ok({ redemption, card: { ...card, used: card.used + 1 }, duplicate: false });
}
