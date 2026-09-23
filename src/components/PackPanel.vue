<script setup lang="ts">
// 页面层：纸质券包登记（领用/使用/作废，余券自动计算）
import { computed, reactive, watch } from "vue";
import { ElMessage } from "element-plus";
import type { Shift } from "../data/types";
import { useHandoverStore } from "../storage/handoverStore";
import { packBalance } from "../rules/packs";

const props = defineProps<{
  shift: Shift;
  electronic: number;
  diff: number;
}>();

const store = useHandoverStore();
const frozen = computed(() => props.shift.status === "closed");

const pack = reactive({
  received: props.shift.pack.received,
  used: props.shift.pack.used,
  voided: props.shift.pack.voided
});

watch(
  () => props.shift.id,
  () => Object.assign(pack, props.shift.pack)
);
watch(
  () => props.shift.pack,
  (p) => Object.assign(pack, p),
  { deep: true }
);

const remaining = computed(() => packBalance(pack));

function save() {
  const r = store.updatePack(props.shift.id, { ...pack });
  if (!r.ok) ElMessage.error(r.error);
  else ElMessage.success(`券包已登记，交班余券 ${r.data.received - r.data.used - r.data.voided} 张`);
}
</script>

<template>
  <el-card shadow="hover" class="sub">
    <template #header>
      <div class="shift-head">
        <strong>纸质券包登记</strong>
        <el-tag v-if="frozen" type="info" size="small">已冻结</el-tag>
      </div>
    </template>
    <el-form :inline="true" @submit.prevent="save">
      <el-form-item label="领用">
        <el-input-number v-model="pack.received" :min="0" :disabled="frozen" />
      </el-form-item>
      <el-form-item label="使用">
        <el-input-number v-model="pack.used" :min="0" :disabled="frozen" />
      </el-form-item>
      <el-form-item label="作废">
        <el-input-number v-model="pack.voided" :min="0" :disabled="frozen" />
      </el-form-item>
      <el-form-item label="交班余券">
        <strong :class="{ bad: remaining < 0 }">{{ remaining }} 张</strong>
        <span class="hint">（领用 − 使用 − 作废）</span>
      </el-form-item>
      <el-button v-if="!frozen" type="primary" @click="save">登记券包</el-button>
    </el-form>
    <p class="hint">
      本班电子核销 {{ electronic }} 次，纸质券使用 {{ pack.used }} 张：
      <span :class="diff === 0 ? 'ok' : 'bad'">
        {{ diff === 0 ? "交接一致" : `不一致，差额 ${diff > 0 ? "+" : ""}${diff}` }}
      </span>
    </p>
  </el-card>
</template>
