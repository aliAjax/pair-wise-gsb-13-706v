// 存储层（编排）：Pinia store，串接规则与持久化，页面只调用这里的动作
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  CouponPack,
  HandoverState,
  Redemption,
  Shift,
  ShiftVersion,
  WashCard
} from "../data/types";
import { loadState, reconcile, saveState, shiftLabel, type Conflict } from "./persistence";
import { validateNewCard, type NewCardInput } from "../rules/cards";
import { planRedemption, type RedeemInput } from "../rules/redemptions";
import { electronicCount, handoverDiff, isConsistent, packBalance, validatePack } from "../rules/packs";
import { fail, ok, type Outcome } from "../rules/result";
import { uid } from "../rules/ids";
import { toDateStr } from "../rules/plates";

export const useHandoverStore = defineStore("handover", () => {
  const initial = loadState();

  const cards = ref<WashCard[]>(initial.cards);
  const shifts = ref<Shift[]>(initial.shifts);
  const redemptions = ref<Redemption[]>(initial.redemptions);
  const versions = ref<ShiftVersion[]>(initial.versions);
  const conflicts = ref<Conflict[]>(reconcile(initial));

  function snapshot(): HandoverState {
    return {
      storageVersion: 1,
      cards: cards.value,
      shifts: shifts.value,
      redemptions: redemptions.value,
      versions: versions.value
    };
  }

  function commit() {
    const state = snapshot();
    saveState(state);
    conflicts.value = reconcile(state);
  }

  // ---------- 次卡 ----------

  function registerCard(input: NewCardInput): Outcome<WashCard> {
    const checked = validateNewCard(input, cards.value);
    if (!checked.ok) return checked;
    const card: WashCard = { ...checked.data, id: uid("card") };
    cards.value = [card, ...cards.value];
    commit();
    return ok(card);
  }

  // ---------- 电子核销（幂等） ----------

  function redeem(input: RedeemInput): Outcome<{ redemption: Redemption; duplicate: boolean }> {
    const shift = shifts.value.find((s) => s.id === requireOpenShiftId());
    if (!shift) return fail("没有进行中的班次，请先开班");

    const planned = planRedemption(input, cards.value, redemptions.value, shift);
    if (!planned.ok) return planned;

    if (!planned.data.duplicate) {
      redemptions.value = [planned.data.redemption, ...redemptions.value];
      cards.value = cards.value.map((c) => (c.id === planned.data.card.id ? planned.data.card : c));
      commit();
    }
    return ok({ redemption: planned.data.redemption, duplicate: planned.data.duplicate });
  }

  // ---------- 班次 ----------

  const activeShiftId = ref<string | null>(
    shifts.value.find((s) => s.status === "open" || s.status === "pending")?.id ?? null
  );

  function requireOpenShiftId(): string | null {
    return activeShiftId.value;
  }

  function openShift(kind: Shift["kind"], opener: string, businessDate = toDateStr()): Outcome<Shift> {
    if (activeShiftId.value) {
      const s = shifts.value.find((x) => x.id === activeShiftId.value);
      return fail(`已有未关班班次：${s ? shiftLabel(s) : activeShiftId.value}`);
    }
    if (!opener.trim()) return fail("请填写开班人");
    const shift: Shift = {
      id: uid("shift"),
      businessDate,
      kind,
      openedAt: new Date().toISOString(),
      closedAt: null,
      opener: opener.trim(),
      status: "open",
      pack: { received: 0, used: 0, voided: 0 },
      discrepancy: null
    };
    shifts.value = [shift, ...shifts.value];
    activeShiftId.value = shift.id;
    commit();
    return ok(shift);
  }

  /** 登记纸质券领用/使用/作废（仅当班可改，关班即冻结） */
  function updatePack(shiftId: string, pack: CouponPack): Outcome<CouponPack> {
    const shift = shifts.value.find((s) => s.id === shiftId);
    if (!shift) return fail("班次不存在");
    if (shift.status === "closed") return fail("班次已关班，券包已冻结；如需更正请走带原因更正");
    const checked = validatePack(pack);
    if (!checked.ok) return checked;
    shift.pack = { ...checked.data };
    commit();
    return ok(shift.pack);
  }

  function addVersion(version: Omit<ShiftVersion, "id" | "at">) {
    versions.value = [
      { ...version, id: uid("ver"), at: new Date().toISOString() },
      ...versions.value
    ];
  }

  /**
   * 关班：电子核销与纸质券使用一致才可关；
   * 不一致整班停在 pending（待处理），记录挂起版本。
   */
  function closeShift(shiftId: string, closer: string): Outcome<Shift> {
    const shift = shifts.value.find((s) => s.id === shiftId);
    if (!shift) return fail("班次不存在");
    if (shift.status === "closed") return fail("班次已关班");
    if (!closer.trim()) return fail("请填写交班人");

    const checkedPack = validatePack(shift.pack);
    if (!checkedPack.ok) return checkedPack;

    if (!isConsistent(shift, redemptions.value)) {
      const diff = handoverDiff(shift, redemptions.value);
      shift.status = "pending";
      addVersion({
        shiftId,
        kind: "hold",
        handler: closer.trim(),
        reason: `电子核销与纸质券使用不一致（差额 ${diff > 0 ? "+" : ""}${diff}），整班自动挂起待处理`,
        before: { status: "open", diff: 0 },
        after: { status: "pending", diff }
      });
      activeShiftId.value = shift.id;
      commit();
      return fail(`交接不一致（差额 ${diff > 0 ? "+" : ""}${diff}），班次已停在待处理`);
    }

    shift.status = "closed";
    shift.closedAt = new Date().toISOString();
    shift.closer = closer.trim();
    addVersion({
      shiftId,
      kind: "close",
      handler: closer.trim(),
      reason: "电子核销与纸质券交接一致，正常关班",
      before: { status: "open" },
      after: {
        status: "closed",
        pack: { ...shift.pack },
        electronic: electronicCount(shiftId, redemptions.value)
      }
    });
    activeShiftId.value = null;
    commit();
    return ok(shift);
  }

  /**
   * 待处理班：处理人写清原因后关班；
   * 若已把券包/核销调整一致则按正常一致关班，否则携带差额说明关班。
   */
  function resolvePending(shiftId: string, handler: string, reason: string): Outcome<Shift> {
    const shift = shifts.value.find((s) => s.id === shiftId);
    if (!shift) return fail("班次不存在");
    if (shift.status !== "pending") return fail("仅待处理班需要处理");
    if (!handler.trim()) return fail("请填写处理人");
    if (!reason.trim()) return fail("请写清处理原因后才能关班");

    const diff = handoverDiff(shift, redemptions.value);
    const before = {
      status: "pending" as const,
      pack: { ...shift.pack },
      discrepancy: shift.discrepancy
    };

    if (diff === 0) {
      shift.status = "closed";
      shift.closedAt = new Date().toISOString();
      shift.closer = handler.trim();
      shift.discrepancy = null;
      addVersion({
        shiftId,
        kind: "resolve",
        handler: handler.trim(),
        reason: `已调整一致：${reason.trim()}`,
        before,
        after: { status: "closed", pack: { ...shift.pack }, diff: 0 }
      });
    } else {
      shift.status = "closed";
      shift.closedAt = new Date().toISOString();
      shift.closer = handler.trim();
      shift.discrepancy = {
        handler: handler.trim(),
        reason: reason.trim(),
        at: new Date().toISOString(),
        diff
      };
      addVersion({
        shiftId,
        kind: "resolve",
        handler: handler.trim(),
        reason: reason.trim(),
        before,
        after: { status: "closed", pack: { ...shift.pack }, discrepancy: shift.discrepancy }
      });
    }
    activeShiftId.value = null;
    commit();
    return ok(shift);
  }

  // ---------- 关班后更正（另建带原因版本，保留旧值） ----------

  function correctPack(shiftId: string, pack: CouponPack, handler: string, reason: string): Outcome<ShiftVersion> {
    const shift = shifts.value.find((s) => s.id === shiftId);
    if (!shift) return fail("班次不存在");
    if (shift.status !== "closed") return fail("仅已关班班次使用更正");
    if (!handler.trim()) return fail("请填写更正人");
    if (!reason.trim()) return fail("更正必须填写原因");
    const checked = validatePack(pack);
    if (!checked.ok) return checked;

    const before = { pack: { ...shift.pack } };
    shift.pack = { ...checked.data };
    const diff = handoverDiff(shift, redemptions.value);
    if (diff !== 0) {
      shift.discrepancy = {
        handler: handler.trim(),
        reason: `券包更正：${reason.trim()}`,
        at: new Date().toISOString(),
        diff
      };
    }
    const version: ShiftVersion = {
      id: uid("ver"),
      shiftId,
      kind: "correct-pack",
      at: new Date().toISOString(),
      handler: handler.trim(),
      reason: reason.trim(),
      before,
      after: { pack: { ...shift.pack }, diff }
    };
    versions.value = [version, ...versions.value];
    commit();
    return ok(version);
  }

  /** 更正电子核销：撤销一条已关班班次中的核销（如误扫），回补次卡余次 */
  function reverseRedemption(redemptionId: string, handler: string, reason: string): Outcome<ShiftVersion> {
    const r = redemptions.value.find((x) => x.id === redemptionId);
    if (!r) return fail("核销记录不存在");
    if (r.reversed) return fail("该核销已撤销");
    const shift = shifts.value.find((s) => s.id === r.shiftId);
    if (!shift) return fail("核销所属班次不存在");
    if (shift.status !== "closed") return fail("当班核销请直接按作废流程处理，无需更正版本");
    if (!handler.trim()) return fail("请填写更正人");
    if (!reason.trim()) return fail("更正必须填写原因");

    const before = {
      redemption: { ...r, reversed: r.reversed ?? false },
      cardUsed: cards.value.find((c) => c.id === r.cardId)?.used
    };
    r.reversed = true;
    const card = cards.value.find((c) => c.id === r.cardId);
    if (card) card.used = Math.max(0, card.used - 1);
    const diff = handoverDiff(shift, redemptions.value);
    if (diff !== 0) {
      shift.discrepancy = {
        handler: handler.trim(),
        reason: `核销撤销：${reason.trim()}`,
        at: new Date().toISOString(),
        diff
      };
    }
    const version: ShiftVersion = {
      id: uid("ver"),
      shiftId: shift.id,
      kind: "correct-redemption",
      at: new Date().toISOString(),
      handler: handler.trim(),
      reason: reason.trim(),
      before,
      after: { redemption: { ...r }, cardUsed: card?.used, diff }
    };
    versions.value = [version, ...versions.value];
    commit();
    return ok(version);
  }

  // ---------- 查询 ----------

  const activeShift = computed(() => shifts.value.find((s) => s.id === activeShiftId.value) ?? null);

  function redemptionsOf(shiftId: string) {
    return redemptions.value.filter((r) => r.shiftId === shiftId);
  }

  function versionsOf(shiftId: string) {
    return versions.value.filter((v) => v.shiftId === shiftId);
  }

  function remainingOf(card: WashCard): number {
    return card.total - card.used;
  }

  return {
    cards,
    shifts,
    redemptions,
    versions,
    conflicts,
    activeShift,
    registerCard,
    redeem,
    openShift,
    updatePack,
    closeShift,
    resolvePending,
    correctPack,
    reverseRedemption,
    redemptionsOf,
    versionsOf,
    remainingOf,
    packBalance,
    electronicCount: (shiftId: string) => electronicCount(shiftId, redemptions.value),
    handoverDiff: (shift: Shift) => handoverDiff(shift, redemptions.value)
  };
});
