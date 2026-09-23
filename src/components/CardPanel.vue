<script setup lang="ts">
// 页面层：次卡登记与次卡台账
import { computed, reactive } from "vue";
import { ElMessage } from "element-plus";
import { useHandoverStore } from "../storage/handoverStore";
import { isCardActive, toDateStr } from "../rules/plates";

const store = useHandoverStore();

const form = reactive({
  code: "",
  plate: "",
  total: 10,
  expiresOn: toDateStr(new Date(Date.now() + 90 * 86400000))
});

const today = toDateStr();

const rows = computed(() =>
  [...store.cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

function statusOf(card: (typeof rows.value)[number]) {
  if (card.used >= card.total) return { text: "次数用尽", type: "info" as const };
  if (!isCardActive(card)) return { text: "已过期", type: "danger" as const };
  return { text: "有效", type: "success" as const };
}

async function submit() {
  const result = store.registerCard({ ...form });
  if (!result.ok) {
    ElMessage.error(result.error);
    return;
  }
  ElMessage.success(`次卡 ${result.data.code}（${result.data.plate}）登记成功`);
  form.code = "";
  form.plate = "";
  form.total = 10;
}
</script>

<template>
  <div class="card-page">
    <el-card shadow="never" class="block">
      <template #header>
        <h3>次卡登记</h3>
      </template>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="卡号" required>
          <el-input v-model="form.code" placeholder="如 WX-2026-0003" />
        </el-form-item>
        <el-form-item label="车牌" required>
          <el-input v-model="form.plate" placeholder="如 京A12345 / 新能源 粤B12345D" />
        </el-form-item>
        <el-form-item label="总次数" required>
          <el-input-number v-model="form.total" :min="1" :max="999" />
        </el-form-item>
        <el-form-item label="有效期末（含当日）" required>
          <el-date-picker v-model="form.expiresOn" type="date" value-format="YYYY-MM-DD" :disabled-date="(d: Date) => toDateStr(d) < today" />
        </el-form-item>
        <el-button type="primary" @click="submit">登记次卡</el-button>
      </el-form>
      <p class="hint">同车牌只能存在一张有效卡；过期或次数用尽后可重新登记。</p>
    </el-card>

    <el-card shadow="never" class="block grow">
      <template #header>
        <h3>次卡台账（{{ rows.length }}）</h3>
      </template>
      <el-table :data="rows" size="small" height="100%" empty-text="暂无次卡">
        <el-table-column prop="code" label="卡号" width="150" />
        <el-table-column prop="plate" label="车牌" width="120" />
        <el-table-column label="次数" width="110">
          <template #default="{ row }">{{ row.used }} / {{ row.total }}</template>
        </el-table-column>
        <el-table-column label="余次" width="70">
          <template #default="{ row }">
            <strong>{{ store.remainingOf(row) }}</strong>
          </template>
        </el-table-column>
        <el-table-column prop="expiresOn" label="有效期末" width="115" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusOf(row).type" size="small">{{ statusOf(row).text }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
