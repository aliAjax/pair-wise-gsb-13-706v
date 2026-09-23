// 状态层：持有快照、调用规则、变更后持久化
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  CouponVersion,
  HandoverSnapshot,
  Redemption,
  Result,
  Shift,
  WashCard,
} from "../domain/types";
import {
  buildConflicts,
  electronicCount,
  latestVersion,
  normalizePlate,
  todayStr,
  validateCouponNumbers,
  validateNewCard,
  validateRedemption,
} from "../domain/rules";
import { loadSnapshot, saveSnapshot } from "../data/storage";

export const useHandoverStore = defineStore("handover", () => {
  const snapshot = ref<HandoverSnapshot>(loadSnapshot());

  const cards = computed(() => snapshot.value.cards);
  const redemptions = computed(() => snapshot.value.redemptions);
  const shifts = computed(() => snapshot.value.shifts);
  const couponVersions = computed(() => snapshot.value.couponVersions);

  const activeShift = computed(() => shifts.value.find((shift) => shift.status === "进行中"));
  const pendingShifts = computed(() => shifts.value.filter((shift) => shift.status === "待处理"));
  const conflicts = computed(() =>
    buildConflicts(shifts.value, couponVersions.value, redemptions.value)
  );

  function persist(): void {
    saveSnapshot(snapshot.value);
  }

  function nextCardId(): string {
    const max = cards.value.reduce((acc, card) => {
      const num = Number(card.id.replace(/\D/g, ""));
      return Number.isFinite(num) && num > acc ? num : acc;
    }, 1000);
    return `WC-${max + 1}`;
  }

  /** 次卡登记：同车牌只能有一张有效卡 */
  function registerCard(plateRaw: string, totalTimes: number, validUntil: string): Result {
    const plate = normalizePlate(plateRaw);
    const error = validateNewCard(cards.value, plate, totalTimes, validUntil, todayStr());
    if (error) return { ok: false, message: error };
    const card: WashCard = {
      id: nextCardId(),
      plate,
      totalTimes,
      usedTimes: 0,
      validUntil,
      createdAt: new Date().toISOString(),
    };
    cards.value.unshift(card);
    persist();
    return { ok: true, message: `次卡 ${card.id}（${plate}）登记成功` };
  }

  /** 核销：幂等提交键去重，过期/用尽/车牌不符拒绝，仅计入进行中班次 */
  function redeem(cardId: string, plateRaw: string, requestKeyRaw: string): Result {
    const requestKey = requestKeyRaw.trim();
    if (!requestKey) return { ok: false, message: "缺少提交键，请换键后重试" };
    const existing = redemptions.value.find((record) => record.requestKey === requestKey);
    if (existing) {
      return { ok: true, duplicated: true, message: "重复提交：已保留首次核销记录，本次不重复扣次" };
    }
    const card = cards.value.find((item) => item.id === cardId);
    const error = validateRedemption({
      card,
      plate: plateRaw,
      shift: activeShift.value,
      today: todayStr(),
    });
    if (error) return { ok: false, message: error };
    const shift = activeShift.value!;
    const target = card!;
    target.usedTimes += 1;
    const record: Redemption = {
      id: crypto.randomUUID(),
      requestKey,
      cardId: target.id,
      plate: target.plate,
      shiftId: shift.id,
      createdAt: new Date().toISOString(),
    };
    redemptions.value.unshift(record);
    persist();
    return {
      ok: true,
      message: `核销成功：${target.plate} 剩余 ${target.totalTimes - target.usedTimes} 次`,
    };
  }

  /** 开班：同时登记券包 V1（领用数），仅允许一个进行中班次 */
  function openShift(labelRaw: string, received: number): Result {
    if (activeShift.value) return { ok: false, message: "已有进行中的班次，请先完成交班" };
    const label = labelRaw.trim();
    if (!label) return { ok: false, message: "请填写班次名称" };
    const error = validateCouponNumbers(received, 0, 0);
    if (error) return { ok: false, message: error };
    const shift: Shift = {
      id: crypto.randomUUID(),
      label,
      status: "进行中",
      openedAt: new Date().toISOString(),
    };
    shifts.value.unshift(shift);
    const version: CouponVersion = {
      id: crypto.randomUUID(),
      shiftId: shift.id,
      version: 1,
      received,
      used: 0,
      voided: 0,
      reason: "开班登记",
      createdAt: new Date().toISOString(),
    };
    couponVersions.value.push(version);
    persist();
    return { ok: true, message: `已开班：${label}，领用纸质券 ${received} 张` };
  }

  /** 保存券包：进行中/待处理可改当前版本；已关班冻结，只能更正新版本 */
  function saveCouponPack(shiftId: string, received: number, used: number, voided: number): Result {
    const shift = shifts.value.find((item) => item.id === shiftId);
    if (!shift) return { ok: false, message: "班次不存在" };
    if (shift.status === "已关班") {
      return { ok: false, message: "班次已关班，券包已冻结，请通过更正生成新版本" };
    }
    const error = validateCouponNumbers(received, used, voided);
    if (error) return { ok: false, message: error };
    const version = latestVersion(couponVersions.value, shiftId);
    if (!version) return { ok: false, message: "券包版本数据缺失" };
    version.received = received;
    version.used = used;
    version.voided = voided;
    persist();
    return { ok: true, message: "券包已保存" };
  }

  /** 交班检查：差额为 0 直接关班；不一致则整班停在待处理 */
  function requestClose(shiftId: string): Result {
    const shift = shifts.value.find((item) => item.id === shiftId);
    if (!shift) return { ok: false, message: "班次不存在" };
    if (shift.status !== "进行中") return { ok: false, message: "仅进行中的班次可执行交班检查" };
    const version = latestVersion(couponVersions.value, shiftId);
    const difference = electronicCount(redemptions.value, shiftId) - (version?.used ?? 0);
    if (difference !== 0) {
      shift.status = "待处理";
      persist();
      return {
        ok: false,
        message: `电子核销与券包使用相差 ${difference} 张，班次已停在待处理，需处理人写清原因后才能关班`,
      };
    }
    shift.status = "已关班";
    shift.closedAt = new Date().toISOString();
    persist();
    return { ok: true, message: "电子核销与券包一致，班次已关闭，核销与券包已冻结" };
  }

  /** 待处理班次：处理人写清原因后才能关班 */
  function resolveClose(shiftId: string, handlerRaw: string, noteRaw: string): Result {
    const shift = shifts.value.find((item) => item.id === shiftId);
    if (!shift) return { ok: false, message: "班次不存在" };
    if (shift.status !== "待处理") return { ok: false, message: "仅待处理班次需要处理差异后关班" };
    const handler = handlerRaw.trim();
    const note = noteRaw.trim();
    if (!handler) return { ok: false, message: "请填写处理人" };
    if (!note) return { ok: false, message: "请写清差异原因" };
    shift.status = "已关班";
    shift.handler = handler;
    shift.handleNote = note;
    shift.closedAt = new Date().toISOString();
    persist();
    return { ok: true, message: "已记录处理人与原因，班次关闭并冻结" };
  }

  /** 关班后更正：另建带原因的版本，旧版本保留 */
  function correctCouponPack(
    shiftId: string,
    received: number,
    used: number,
    voided: number,
    reasonRaw: string
  ): Result {
    const shift = shifts.value.find((item) => item.id === shiftId);
    if (!shift) return { ok: false, message: "班次不存在" };
    if (shift.status !== "已关班") return { ok: false, message: "仅已关班班次支持更正版本" };
    const reason = reasonRaw.trim();
    if (!reason) return { ok: false, message: "请填写更正原因" };
    const error = validateCouponNumbers(received, used, voided);
    if (error) return { ok: false, message: error };
    const nextVersion =
      Math.max(0, ...couponVersions.value.filter((v) => v.shiftId === shiftId).map((v) => v.version)) + 1;
    const version: CouponVersion = {
      id: crypto.randomUUID(),
      shiftId,
      version: nextVersion,
      received,
      used,
      voided,
      reason,
      createdAt: new Date().toISOString(),
    };
    couponVersions.value.push(version);
    persist();
    return { ok: true, message: `已生成更正版本 V${nextVersion}，旧版本已保留` };
  }

  return {
    cards,
    redemptions,
    shifts,
    couponVersions,
    activeShift,
    pendingShifts,
    conflicts,
    registerCard,
    redeem,
    openShift,
    saveCouponPack,
    requestClose,
    resolveClose,
    correctCouponPack,
  };
});
