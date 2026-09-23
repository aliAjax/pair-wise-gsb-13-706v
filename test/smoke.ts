// 规则/存储冒烟测试（不经过浏览器，直接跑在 node 上）
// 用法: npx esbuild test/smoke.ts --bundle --platform=node --format=esm | node
import { buildSeedState } from "../src/data/seed";
import { loadState, STORAGE_KEY } from "../src/storage/persistence";
import { useHandoverStore } from "../src/storage/handoverStore";
import { setActivePinia, createPinia } from "pinia";
import { newRequestId } from "../src/rules/ids";

// 内存版 localStorage
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v);
  }
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

function freshStore() {
  mem.clear();
  setActivePinia(createPinia());
  return useHandoverStore();
}

// 种子数据：已关班班次对账应一致，无冲突
{
  const store = freshStore();
  check("种子状态无对账冲突", store.conflicts.length === 0, JSON.stringify(store.conflicts));
  check("种子次卡 used=2 与核销台账一致", store.cards[0].used === 2);
}

// 1. 次卡登记规则
{
  const store = freshStore();
  const r1 = store.registerCard({ code: "C1", plate: "京a12345", total: 5, expiresOn: "2099-01-01" });
  check("同车牌已有有效卡 → 拒绝登记", !r1.ok && /已有有效卡/.test(r1.ok ? "" : r1.error));
  const bad = store.registerCard({ code: "C2", plate: "XYZ", total: 3, expiresOn: "2099-01-01" });
  check("非法车牌 → 拒绝", !bad.ok);
  const zero = store.registerCard({ code: "C2", plate: "沪A99999", total: 0, expiresOn: "2099-01-01" });
  check("总次数非正 → 拒绝", !zero.ok);
  const expired = store.registerCard({ code: "C2", plate: "沪A99999", total: 3, expiresOn: "2000-01-01" });
  check("登记时已过期 → 拒绝", !expired.ok);
  const ok2 = store.registerCard({ code: "C2", plate: "沪a99999", total: 3, expiresOn: "2099-01-01" });
  check("新车牌登记成功且车牌规范化大写", ok2.ok && store.cards.find((c) => c.code === "C2")?.plate === "沪A99999");
  const dup = store.registerCard({ code: "C2", plate: "渝A11111", total: 3, expiresOn: "2099-01-01" });
  check("重复卡号 → 拒绝", !dup.ok);
}

// 2. 核销：车牌不符 / 过期 / 用尽 / 幂等 / 待处理冻结
{
  const store = freshStore();
  // 种子有一个 open 班次 shift-seed-2
  const shift = store.activeShift!;
  check("种子存在当班", !!shift && shift.kind === "早班");

  const req = newRequestId();
  const wrong = store.redeem({ cardCode: "WX-2026-0001", plate: "京B00000", requestId: newRequestId() });
  check("车牌不符 → 拒绝核销", !wrong.ok && /车牌不符/.test(wrong.ok ? "" : wrong.error));

  const usedUp = store.redeem({ cardCode: "WX-2026-0002", plate: "粤B88888", requestId: newRequestId() });
  check("次数用尽 → 拒绝核销", !usedUp.ok && /用尽/.test(usedUp.ok ? "" : usedUp.error));

  const r1 = store.redeem({ cardCode: "WX-2026-0001", plate: "京a12345", requestId: req });
  check("正常核销成功", r1.ok && !r1.data.duplicate);
  check("核销后余次递减", store.cards[0].used === 3 && store.remainingOf(store.cards[0]) === 7);

  const r2 = store.redeem({ cardCode: "WX-2026-0001", plate: "京A12345", requestId: req });
  check("同一提交令牌重复提交 → 幂等返回首次", r2.ok && r2.data.duplicate);
  check("幂等不重复扣次", store.cards[0].used === 3);
  check("核销台账只有一条新记录", store.redemptionsOf(shift.id).length === 1);

  // 券包使用 0，电子核销 1 → 关班应挂起 pending
  const close = store.closeShift(shift.id, "李站长");
  check("交接不一致 → 关班被拒并挂起待处理", !close.ok && store.activeShift?.status === "pending");
  check("挂起产生 hold 版本", store.versions.some((v) => v.kind === "hold"));

  const frozenRedeem = store.redeem({ cardCode: "WX-2026-0001", plate: "京A12345", requestId: newRequestId() });
  check("待处理班核销暂停", !frozenRedeem.ok && /待处理/.test(frozenRedeem.ok ? "" : frozenRedeem.error));

  const noReason = store.resolvePending(shift.id, "李站长", "  ");
  check("未写原因不能关班", !noReason.ok);
  const resolved = store.resolvePending(shift.id, "李站长", "1次电子核销为系统赠洗，无纸质券，监控确认");
  check("写清原因后关班", resolved.ok && store.activeShift === null);
  const closedShift = store.shifts.find((s) => s.id === shift.id)!;
  check("差额说明落档", closedShift.discrepancy?.diff === 1);
  check("关班后核销冻结", !store.redeem({ cardCode: "WX-2026-0001", plate: "京A12345", requestId: newRequestId() }).ok);
  check("关班后券包冻结", !store.updatePack(shift.id, { received: 1, used: 0, voided: 0 }).ok);
}

// 3. 一致关班 + 余券计算
{
  const store = freshStore();
  const shift = store.activeShift!;
  store.redeem({ cardCode: "WX-2026-0001", plate: "京A12345", requestId: newRequestId() });
  const p = store.updatePack(shift.id, { received: 5, used: 1, voided: 2 });
  check("券包登记成功，余券=5-1-2=2", p.ok && store.packBalance(p.ok ? store.activeShift!.pack : { received: 0, used: 0, voided: 0 }) === 2);
  const badPack = store.updatePack(shift.id, { received: 1, used: 2, voided: 0 });
  check("使用超过领用 → 拒绝", !badPack.ok);
  const closed = store.closeShift(shift.id, "李站长");
  check("电子核销与纸质券一致 → 正常关班", closed.ok);
  check("正常关班产生 close 版本", store.versions.some((v) => v.kind === "close"));
}

// 4. 关班后更正：另建带原因版本并保留旧值
{
  const store = freshStore();
  const shift = store.activeShift!;
  store.updatePack(shift.id, { received: 5, used: 0, voided: 0 });
  store.closeShift(shift.id, "李站长");
  const noReason = store.correctPack(shift.id, { received: 5, used: 1, voided: 0 }, "王站长", "  ");
  check("更正无原因 → 拒绝", !noReason.ok);
  const cor = store.correctPack(shift.id, { received: 5, used: 1, voided: 0 }, "王站长", "复核实物券，确认使用1张");
  check("带原因更正成功", cor.ok);
  const ver = store.versions.find((v) => v.kind === "correct-pack")!;
  check("版本保留旧值 used=0", (ver.before as any).pack.used === 0);
  check("版本记录新值 used=1", (ver.after as any).pack.used === 1);

  // 核销撤销更正
  const rd = store.redemptionsOf("shift-seed-1")[0];
  const beforeUsed = store.cards.find((c) => c.id === rd.cardId)!.used;
  const rev = store.reverseRedemption(rd.id, "王站长", "误扫撤销");
  check("关班班核销撤销成功", rev.ok);
  const updated = store.redemptions.find((r) => r.id === rd.id)!;
  check("核销标记已撤销且回补余次", updated.reversed === true && store.cards.find((c) => c.id === rd.cardId)!.used === beforeUsed - 1);
  check("撤销产生 correct-redemption 版本", store.versions.some((v) => v.kind === "correct-redemption"));
}

// 5. 刷新后一致 + 人为篡改制造冲突
{
  const store = freshStore();
  // 触发一次写动作以落盘
  store.updatePack(store.activeShift!.id, { ...store.activeShift!.pack });
  check("刷新加载后无冲突", store.conflicts.length === 0);
  // 篡改 localStorage：把某卡 used 改大
  const raw = JSON.parse(mem.get(STORAGE_KEY)!);
  raw.cards[0].used += 3;
  mem.set(STORAGE_KEY, JSON.stringify(raw));
  setActivePinia(createPinia());
  const store2 = useHandoverStore();
  check("篡改次卡 used → 刷新后列出冲突（车牌/卡号/班次/差额）", store2.conflicts.length > 0);
  const c = store2.conflicts[0];
  check("冲突含车牌、卡号、班次与差额", c.plate === "京A12345" && c.cardCode === "WX-2026-0001" && !!c.shiftLabel && c.cardLedgerDelta === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
