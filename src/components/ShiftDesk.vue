<script setup lang="ts">
// 页面层：交班台（开班、电子核销、纸质券包、关班、待处理）
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useHandoverStore } from "../storage/handoverStore";
import { newRequestId } from "../rules/ids";
import { isCardActive, normalizePlate, toDateStr } from "../rules/plates";
import PackPanel from "./PackPanel.vue";
import type { Shift } from "../data/types";

const store = useHandoverStore();

// ---------- 开班 ----------
const openForm = reactive({
  businessDate: toDateStr(),
  kind: "早班" as Shift["kind"],
  opener: ""
});
const kinds = ["早班", "中班", "晚班"] as const;

function openShift() {
  const r = store.openShift(openForm.kind, openForm.opener, openForm.businessDate);
  if (!r.ok) {
    ElMessage.error(r.error);
    return;
  }
  ElMessage.success(`${r.data.businessDate} ${r.data.kind} 已开班`);
  openForm.opener = "";
}

// ---------- 电子核销 ----------
const redeemForm = reactive({
  cardCode: "",
  plate: "",
  requestId: newRequestId()
});

const matchedCard = computed(() => {
  const code = redeemForm.cardCode.trim();
  if (!code) return null;
  return store.cards.find((c) => c.code === code) ?? null;
});

watch(matchedCard, (card) => {
  // 选中卡后预填登记车牌，操作员仍可手改以触发“车牌不符”校验
  if (card && !redeemForm.plate) redeemForm.plate = card.plate;
});

function resetRedeemForm() {
  redeemForm.cardCode = "";
  redeemForm.plate = "";
  redeemForm.requestId = newRequestId();
}

function doRedeem() {
  if (!redeemForm.cardCode.trim()) {
    ElMessage.error("请输入卡号");
    return;
  }
  const r = store.redeem({
    cardCode: redeemForm.cardCode.trim(),
    plate: redeemForm.plate,
    requestId: redeemForm.requestId
  });
  if (!r.ok) {
    ElMessage.error(r.error);
    return;
  }
  ElMessage.success(
    r.duplicate
      ? `重复提交已拦截：沿用首次核销（${r.data.redemption.cardCode} / ${r.data.redemption.plate}）`
      : `核销成功：${r.data.redemption.cardCode} / ${r.data.redemption.plate}`
  );
  // 保持 requestId 不变直到点“下一单”，便于验证重复提交只保留首次
  redeemForm.cardCode = "";
  redeemForm.plate = "";
}

const active = computed(() => store.activeShift);
const activeRedemptions = computed(() => (active.value ? store.redemptionsOf(active.value.id) : []));
const electronic = computed(() => (active.value ? store.electronicCount(active.value.id) : 0));
const packDiff = computed(() => (active.value ? store.handoverDiff(active.value) : 0));
const holdTitle = computed(
  () =>
    `电子核销与券包交接不一致（差额 ${packDiff.value > 0 ? "+" : ""}${packDiff.value}），整班停在待处理，核销已暂停；处理人写清原因后才能关班`
);

async function closeShift() {
  if (!active.value) return;
  try {
    const { value } = await ElMessageBox.prompt("请输入交班人", "关班冻结", {
      confirmButtonText: "执行关班",
      cancelButtonText: "取消",
      inputValidator: (v) => !!v?.trim() || "交班人不能为空"
    });
    const r = store.closeShift(active.value.id, value);
    if (!r.ok) ElMessage.warning(r.error);
    else ElMessage.success("已关班，核销与券包均已冻结");
  } catch {
    /* 取消 */
  }
}

// ---------- 待处理 ----------
const resolveForm = reactive({ handler: "", reason: "" });

function resolvePending() {
  if (!active.value) return;
  const r = store.resolvePending(active.value.id, resolveForm.handler, resolveForm.reason);
  if (!r.ok) {
    ElMessage.error(r.error);
    return;
  }
  ElMessage.success("已写清处理原因并关班");
  resolveForm.handler = "";
  resolveForm.reason = "";
}

const statusMeta: Record<Shift["status"], { text: string; type: "success" | "warning" | "info" }> = {
  open: { text: "当班中", type: "success" },
  pending: { text: "待处理", type: "warning" },
  closed: { text: "已关班冻结", type: "info" }
};
</script>

<template>
  <div class="desk">
    <!-- 无当班：开班 -->
    <el-card v-if="!active" shadow="never" class="block">
      <template #header><h3>开班登记</h3></template>
      <el-form :inline="true" @submit.prevent="openShift">
        <el-form-item label="营业日">
          <el-date-picker v-model="openForm.businessDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="班次">
          <el-select v-model="openForm.kind" style="width: 100px">
            <el-option v-for="k in kinds" :key="k" :label="k" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="开班人">
          <el-input v-model="openForm.opener" placeholder="姓名" />
        </el-form-item>
        <el-button type="primary" @click="openShift">开班</el-button>
      </el-form>
    </el-card>

    <template v-else>
      <el-card shadow="never" class="block">
        <template #header>
          <div class="shift-head">
            <h3>{{ active.businessDate }} {{ active.kind }} · 交班台</h3>
            <el-tag :type="statusMeta[active.status].type">{{ statusMeta[active.status].text }}</el-tag>
          </div>
        </template>
        <p class="meta">开班人：{{ active.opener }}　开班时间：{{ new Date(active.openedAt).toLocaleString("zh-CN") }}</p>

        <el-alert
          v-if="active.status === 'pending'"
          type="error"
          :closable="false"
          show-icon
          class="hold-banner"
          :title="holdTitle"
        />

        <!-- 电子核销 -->
        <el-card shadow="hover" class="sub">
          <template #header><strong>电子核销（次卡）</strong></template>
          <el-form :inline="true" @submit.prevent="doRedeem">
            <el-form-item label="卡号">
              <el-select
                v-model="redeemForm.cardCode"
                filterable
                allow-create
                placeholder="选择或输入卡号"
                style="width: 200px"
              >
                <el-option
                  v-for="c in store.cards"
                  :key="c.id"
                  :label="`${c.code}（${c.plate} 余${store.remainingOf(c)}）`"
                  :value="c.code"
                  :disabled="!isCardActive(c)"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="车牌">
              <el-input v-model="redeemForm.plate" placeholder="核销车辆车牌" style="width: 180px" />
            </el-form-item>
            <el-button type="primary" :disabled="active.status !== 'open'" @click="doRedeem">
              确认核销
            </el-button>
            <el-button @click="resetRedeemForm">下一单（换新提交令牌）</el-button>
          </el-form>
          <p class="hint">
            过期、次数用尽、车牌不符一律拒绝；同一提交令牌重复点击“确认核销”只保留首次。
            <span v-if="matchedCard" :class="isCardActive(matchedCard) ? 'ok' : 'bad'">
              当前卡：{{ matchedCard.code }} / {{ matchedCard.plate }}，
              余 {{ store.remainingOf(matchedCard) }} 次，有效期末 {{ matchedCard.expiresOn }}
              {{ normalizePlate(redeemForm.plate) !== matchedCard.plate ? "（车牌与登记不符）" : "" }}
            </span>
          </p>

          <el-table :data="activeRedemptions" size="small" max-height="220" empty-text="本班暂无核销">
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ new Date(row.at).toLocaleString("zh-CN") }}</template>
            </el-table-column>
            <el-table-column prop="cardCode" label="卡号" width="150" />
            <el-table-column prop="plate" label="车牌" width="110" />
            <el-table-column label="提交令牌" min-width="180">
              <template #default="{ row }"><span class="mono">{{ row.requestId }}</span></template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 纸质券包 -->
        <PackPanel :shift="active" :electronic="electronic" :diff="packDiff" />

        <!-- 关班 / 处理 -->
        <div class="footer-actions">
          <template v-if="active.status === 'open'">
            <el-tooltip content="关班后核销与券包冻结，更正须另建带原因版本" placement="top">
              <el-button type="danger" size="large" @click="closeShift">关班冻结</el-button>
            </el-tooltip>
            <span class="hint">
              本班电子核销 {{ electronic }} 次，纸质券使用 {{ active.pack.used }} 张，
              余券 {{ store.packBalance(active.pack) }} 张
              （{{ packDiff === 0 ? "一致，可关班" : `差额 ${packDiff > 0 ? "+" : ""}${packDiff}，关班将挂起待处理` }}）
            </span>
          </template>

          <template v-else-if="active.status === 'pending'">
            <el-card shadow="never" class="resolve">
              <template #header><strong>待处理交接 —— 处理人填写</strong></template>
              <el-form label-position="top" @submit.prevent="resolvePending">
                <el-form-item label="处理人" required>
                  <el-input v-model="resolveForm.handler" placeholder="姓名" style="max-width: 240px" />
                </el-form-item>
                <el-form-item label="原因说明（写清后才能关班）" required>
                  <el-input v-model="resolveForm.reason" type="textarea" :rows="3" placeholder="如：2张电子核销为赠洗，未领用纸质券，经站长确认放行" />
                </el-form-item>
                <el-button type="primary" @click="resolvePending">写清原因并关班</el-button>
                <el-button @click="closeShift">先调整券包为一致再关班</el-button>
              </el-form>
            </el-card>
          </template>
        </div>
      </el-card>
    </template>
  </div>
</template>
