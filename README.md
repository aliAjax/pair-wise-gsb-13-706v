# 洗车次卡与券包交班台

- 行业：石油（加油站洗车业务）
- 技术栈：Vue3、Vite、TypeScript、Pinia、Element Plus
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

## 功能

- **次卡**：登记车牌、总次数、有效期末；同车牌只能有一张有效卡。核销时过期、次数用尽或车牌不符均拒绝；提交键幂等，重复提交只保留首次。
- **券包**：每班登记纸质券领用、使用、作废，交班余券 = 领用 − 使用 − 作废。
- **交班**：电子核销与券包使用不一致时整班停在待处理，处理人写清原因后才能关班。
- **关班**：冻结核销与券包；更正另建带原因的版本并保留旧值。
- **一致性**：数据存 localStorage，刷新后次卡、班次、券包、版本一致；冲突清单列出车牌、卡号、班次与差额。

## 结构（数据 / 规则 / 存储 / 页面分离）

- `src/domain/types.ts` — 数据模型（次卡、核销、班次、券包版本、冲突）
- `src/domain/rules.ts` — 纯业务规则（登记/核销校验、余券、差额、冲突计算）
- `src/data/seed.ts`、`src/data/storage.ts` — 种子数据与 localStorage 存储
- `src/stores/handover.ts` — Pinia 状态与动作
- `src/App.vue` — 页面
