<script setup lang="ts">
// 页面层：刷新后对账冲突提示（车牌、卡号、班次与差额）
import { useHandoverStore } from "../storage/handoverStore";

const store = useHandoverStore();
</script>

<template>
  <el-alert
    v-if="store.conflicts.length"
    type="error"
    show-icon
    :closable="false"
    class="conflict-alert"
    :title="`刷新后对账发现 ${store.conflicts.length} 处不一致`"
  >
    <el-table :data="store.conflicts" size="small" class="conflict-table">
      <el-table-column prop="plate" label="车牌" width="120" />
      <el-table-column prop="cardCode" label="卡号" width="150" />
      <el-table-column prop="shiftLabel" label="班次" width="200" />
      <el-table-column label="次卡台账差额" width="130">
        <template #default="{ row }">
          <span :class="row.cardLedgerDelta === 0 ? '' : 'bad'">
            {{ row.cardLedgerDelta > 0 ? "+" : "" }}{{ row.cardLedgerDelta }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="交接差额（电子核销 − 纸质券使用）">
        <template #default="{ row }">
          <span :class="row.handoverDelta === 0 ? '' : 'bad'">
            {{ row.handoverDelta > 0 ? "+" : "" }}{{ row.handoverDelta }}
          </span>
        </template>
      </el-table-column>
    </el-table>
  </el-alert>
  <el-alert
    v-else
    type="success"
    show-icon
    :closable="false"
    title="刷新后对账通过：次卡、班次、券包与版本一致"
    class="conflict-alert"
  />
</template>
