// 规则层：ID 生成（无第三方依赖）
export function uid(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${Date.now().toString(36)}-${hex}`;
}

/** 每次打开核销表单生成新的提交令牌；同一令牌重复提交只保留首次 */
export function newRequestId(): string {
  return uid("req");
}
