// 种子数据：首次进入（或数据损坏）时生成，保证页面开箱即可演示完整闭环
import type { HandoverSnapshot, Redemption } from "../domain/types";
import { todayStr } from "../domain/rules";

function daysFromNow(days: number): string {
  return todayStr(new Date(Date.now() + days * 86400000));
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

export function buildSeed(): HandoverSnapshot {
  const today = todayStr();
  const yesterday = daysFromNow(-1);

  const redemptions: Redemption[] = [];
  let seq = 0;
  const addRedemption = (
    cardId: string,
    plate: string,
    shiftId: string,
    count: number,
    startMinutes: number
  ) => {
    for (let i = 0; i < count; i += 1) {
      seq += 1;
      redemptions.push({
        id: `R-${String(seq).padStart(4, "0")}`,
        requestKey: `seed-${shiftId}-${cardId}-${i + 1}`,
        cardId,
        plate,
        shiftId,
        createdAt: minutesAgo(startMinutes + i * 7),
      });
    }
  };

  // S-1 已关班：电子 2 = 券使用 2，账实一致
  addRedemption("WC-1001", "京A12345", "S-1", 1, 60 * 26);
  addRedemption("WC-1002", "津B23456", "S-1", 1, 60 * 26 + 7);
  // S-2 待处理：电子 5 vs 券使用 4，差额 +1，进入冲突清单
  addRedemption("WC-1003", "冀C77777", "S-2", 5, 60 * 18);
  // S-3 进行中：电子 4 = 券使用 4
  addRedemption("WC-1001", "京A12345", "S-3", 1, 160);
  addRedemption("WC-1003", "冀C77777", "S-3", 3, 150);

  return {
    cards: [
      { id: "WC-1001", plate: "京A12345", totalTimes: 10, usedTimes: 2, validUntil: daysFromNow(30), createdAt: minutesAgo(60 * 30) },
      { id: "WC-1002", plate: "津B23456", totalTimes: 5, usedTimes: 1, validUntil: daysFromNow(30), createdAt: minutesAgo(60 * 30) },
      { id: "WC-1003", plate: "冀C77777", totalTimes: 8, usedTimes: 8, validUntil: daysFromNow(15), createdAt: minutesAgo(60 * 30) },
      { id: "WC-1004", plate: "鲁D88888", totalTimes: 6, usedTimes: 0, validUntil: daysFromNow(-10), createdAt: minutesAgo(60 * 24 * 40) },
    ],
    redemptions,
    shifts: [
      { id: "S-3", label: `${today} 早班`, status: "进行中", openedAt: minutesAgo(180) },
      { id: "S-2", label: `${yesterday} 晚班`, status: "待处理", openedAt: minutesAgo(60 * 20) },
      {
        id: "S-1",
        label: `${yesterday} 中班`,
        status: "已关班",
        openedAt: minutesAgo(60 * 30),
        closedAt: minutesAgo(60 * 24),
        handler: "王站长",
        handleNote: "账实一致，正常关班",
      },
    ],
    couponVersions: [
      { id: "V-S1-1", shiftId: "S-1", version: 1, received: 10, used: 2, voided: 1, reason: "开班登记", createdAt: minutesAgo(60 * 30) },
      { id: "V-S2-1", shiftId: "S-2", version: 1, received: 20, used: 4, voided: 0, reason: "开班登记", createdAt: minutesAgo(60 * 20) },
      { id: "V-S3-1", shiftId: "S-3", version: 1, received: 50, used: 4, voided: 1, reason: "开班登记", createdAt: minutesAgo(180) },
    ],
  };
}
