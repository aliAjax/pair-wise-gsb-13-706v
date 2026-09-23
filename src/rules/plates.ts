// 规则层：车牌与日期等纯校验规则
import type { WashCard } from "../data/types";

/** 车牌规范化：去空格、大写。支持普通车牌与新能源车牌 */
export function normalizePlate(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

const PLATE_RE = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-HJ-NP-Z0-9]{4,6}[A-HJ-NP-Z0-9挂学警港澳]$/;

export function isValidPlate(plate: string): boolean {
  return PLATE_RE.test(plate);
}

/** YYYY-MM-DD 是否为合法日期 */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  return !Number.isNaN(d.getTime()) && toDateStr(d) === s;
}

export function toDateStr(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 是否过期（有效期末含当日，当天仍可核销） */
export function isExpired(card: Pick<WashCard, "expiresOn">, today = toDateStr()): boolean {
  return card.expiresOn < today;
}

/** 次数是否用尽 */
export function isUsedUp(card: Pick<WashCard, "total" | "used">): boolean {
  return card.used >= card.total;
}

/** 该卡当前是否仍为有效卡（未过期且有余次） */
export function isCardActive(card: WashCard, today = toDateStr()): boolean {
  return !isExpired(card, today) && !isUsedUp(card);
}
