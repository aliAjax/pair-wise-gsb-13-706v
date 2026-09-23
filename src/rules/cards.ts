// 规则层：次卡登记规则
import type { WashCard } from "../data/types";
import { fail, ok, type Outcome } from "./result";
import { isExpired, isValidDate, isValidPlate, normalizePlate, toDateStr } from "./plates";

export interface NewCardInput {
  code: string;
  plate: string;
  total: number;
  expiresOn: string;
}

/**
 * 次卡登记规则：
 * - 车牌合法、总次数为正整数、有效期合法且未过期
 * - 卡号唯一
 * - 同车牌只能有一张有效卡（未过期且有余次）
 */
export function validateNewCard(
  input: NewCardInput,
  cards: readonly WashCard[],
  today = toDateStr()
): Outcome<WashCard & { createdAt: string }> {
  const code = input.code.trim();
  const plate = normalizePlate(input.plate);
  const total = Number(input.total);
  const expiresOn = input.expiresOn;

  if (!code) return fail("请填写卡号");
  if (cards.some((c) => c.code === code)) return fail(`卡号 ${code} 已存在`);
  if (!isValidPlate(plate)) return fail("车牌格式不正确，示例：京A12345 / 粤B12345D");
  if (!Number.isInteger(total) || total <= 0) return fail("总次数须为正整数");
  if (!isValidDate(expiresOn)) return fail("有效期格式不正确");
  if (isExpired({ expiresOn }, today)) return fail("有效期末已过，不能登记");

  const active = cards.find((c) => c.plate === plate && !isExpired(c, today) && c.used < c.total);
  if (active) {
    return fail(`车牌 ${plate} 已有有效卡 ${active.code}（余次 ${active.total - active.used}），不能重复登记`);
  }

  return ok({
    id: "",
    code,
    plate,
    total,
    used: 0,
    expiresOn,
    createdAt: new Date().toISOString()
  } as WashCard & { createdAt: string });
}
