# 洗车次卡与券包交班台

- 行业：石油（加油站洗车业务）
- 技术栈：Vue3、Vite、TypeScript、Element Plus、Pinia
- 启动：`npm install && npm run dev`
- 构建：`npm run build`
- 规则冒烟测试：`npx esbuild test/smoke.ts --bundle --platform=node --format=esm --outfile=/tmp/smoke.mjs && node /tmp/smoke.mjs`

数据保存在浏览器 localStorage（key：`car-wash-handover-v1`），刷新后自动对账。

## 业务规则

- **次卡登记**：车牌、总次数、有效期末；同车牌只能有一张有效卡（未过期且有余次）。
- **电子核销**：逐次核销，过期、次数用尽、车牌不符一律拒绝；按提交令牌幂等，重复提交只保留首次。
- **纸质券包**：每班登记领用 / 使用 / 作废，交班余券 = 领用 − 使用 − 作废（不允许为负）。
- **交接关班**：电子核销次数与纸质券使用张数一致才能关班；不一致整班停在「待处理」且核销暂停，处理人写清原因后才能关班（差额说明随班落档）。
- **冻结与更正**：关班后核销与券包冻结；更正不覆盖旧值，另建带原因版本（券包更正 / 核销撤销），版本中永久保留旧值与新值。
- **刷新对账**：加载即校验次卡、班次、券包与版本一致性；冲突列出车牌、卡号、班次与差额（次卡台账差额 + 交接差额）。

## 分层结构

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 数据 | `src/data` | 领域类型 `types.ts`、种子数据 `seed.ts`，无任何逻辑 |
| 规则 | `src/rules` | 纯函数：车牌/日期、次卡登记、核销幂等、券包与交接一致性、结果类型 |
| 存储 | `src/storage` | localStorage 读写与刷新对账 `persistence.ts`、Pinia 编排 `handoverStore.ts` |
| 页面 | `src/components` + `App.vue` | Element Plus 页面：交班台、次卡登记、班次与版本、冲突条 |
