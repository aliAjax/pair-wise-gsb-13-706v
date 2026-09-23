// 数据层：种子数据（首次进入时的演示数据）
import type { HandoverState } from "./types";

export function buildSeedState(now = Date.now()): HandoverState {
  const iso = (offsetHours: number) => new Date(now - offsetHours * 3600_000).toISOString();
  const day = 24 * 3600_000;
  const date = (offsetDays: number) => new Date(now + offsetDays * day).toISOString().slice(0, 10);

  return {
    storageVersion: 1,
    cards: [
      {
        id: "card-seed-1",
        code: "WX-2026-0001",
        plate: "京A12345",
        total: 10,
        used: 2,
        expiresOn: date(90),
        createdAt: iso(72)
      },
      {
        id: "card-seed-2",
        code: "WX-2026-0002",
        plate: "粤B88888",
        total: 5,
        used: 5,
        expiresOn: date(30),
        createdAt: iso(96)
      }
    ],
    shifts: [
      {
        id: "shift-seed-1",
        businessDate: date(-1),
        kind: "早班",
        openedAt: iso(30),
        closedAt: iso(22),
        opener: "张师傅",
        closer: "李站长",
        status: "closed",
        pack: { received: 12, used: 7, voided: 1 },
        discrepancy: null
      },
      {
        id: "shift-seed-2",
        businessDate: date(0),
        kind: "早班",
        openedAt: iso(4),
        closedAt: null,
        opener: "王加油员",
        status: "open",
        pack: { received: 10, used: 0, voided: 0 },
        discrepancy: null
      }
    ],
    redemptions: [
      {
        id: "rd-seed-1",
        cardId: "card-seed-1",
        cardCode: "WX-2026-0001",
        plate: "京A12345",
        shiftId: "shift-seed-1",
        at: iso(26),
        requestId: "req-seed-1"
      },
      {
        id: "rd-seed-2",
        cardId: "card-seed-1",
        cardCode: "WX-2026-0001",
        plate: "京A12345",
        shiftId: "shift-seed-1",
        at: iso(25),
        requestId: "req-seed-2"
      },
      ...[0, 1, 2, 3, 4].map(
        (i): HandoverState["redemptions"][number] => ({
          id: `rd-seed-${3 + i}`,
          cardId: "card-seed-2",
          cardCode: "WX-2026-0002",
          plate: "粤B88888",
          shiftId: "shift-seed-1",
          at: iso(25 - i),
          requestId: `req-seed-${3 + i}`
        })
      )
    ],
    versions: []
  };
}
