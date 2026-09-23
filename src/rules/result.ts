// 规则层通用返回：成功携带数据，失败携带面向用户的原因
export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): Outcome<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: string): Outcome<T> {
  return { ok: false, error };
}
