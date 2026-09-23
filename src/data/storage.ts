// 存储层：localStorage 读写，任何变更后整体落盘，刷新后次卡/班次/券包/版本保持一致
import type { HandoverSnapshot } from "../domain/types";
import { buildSeed } from "./seed";

export const STORAGE_KEY = "dfwlfront-7-wash-handover";

function isSnapshot(value: unknown): value is HandoverSnapshot {
  const snapshot = value as HandoverSnapshot | null;
  return (
    Boolean(snapshot) &&
    Array.isArray(snapshot!.cards) &&
    Array.isArray(snapshot!.redemptions) &&
    Array.isArray(snapshot!.shifts) &&
    Array.isArray(snapshot!.couponVersions)
  );
}

export function loadSnapshot(): HandoverSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isSnapshot(parsed)) return parsed;
    }
  } catch {
    // 数据损坏时回退到种子数据
  }
  const seed = buildSeed();
  saveSnapshot(seed);
  return seed;
}

export function saveSnapshot(snapshot: HandoverSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}
