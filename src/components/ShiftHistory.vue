<script setup lang="ts">
// 页面层：班次历史、版本留痕与关班后更正
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useHandoverStore } from "../storage/handoverStore";
import { packBalance } from "../rules/packs";
import type { CouponPack, Shift } from "../data/types";

const store = useHandoverStore();
const selectedId = ref<string | null>(null);

const shifts = computed(() =>
  [...store.shifts].sort((a, b) => b.openedAt.localeCompare(a.openedAt))
);

const selected = computed(() => shifts.value.find((s) => s.id === selectedId.value) ?? null);

const statusTag = (s: Shift["status"]) =>
  s === "open"
    ? { text: "当班中", type: "success" as const }
    : s === "pending"
      ? { text: "待处理", type: "warning" as const }
      : { text: "已关班冻结", type: "info" as const };

const versionKindText: Record<string, string> = {
  hold: "挂起待处理",
  close: "关班",
  resolve: "处理后关班",
  "correct-pack": "券包更正",
  "correct-redemption": "核销更正"
};

// ---------- 更正券包 ----------
const packDialog = reactive({
  visible: false,
  received: 0,
  used: 0,
  voided: 0,
  handler: "",
  reason: ""
});

function openPackDialog(shift: Shift) {
  Object.assign(packDialog, {
    visible: true,
    received: shift.pack.received,
    used: shift.pack.used,
    voided: shift.pack.voided,
    handler: "",
    reason: ""
  });
}

function submitPackCorrection() {
  if (!selected.value) return;
  const pack: CouponPack = {
    received: packDialog.received,
    used: packDialog.used,
    voided: packDialog.voided
  };
  const r = store.correctPack(selected.value.id, pack, packDialog.handler, packDialog.reason);
  if (!r.ok) {
    ElMessage.error(r.error);
    return;
  }
  ElMessage.success("券包已更正，旧值保留在新版本中");
  packDialog.visible = false;
}

// ---------- 撤销核销 ----------
const rdDialog = reactive({ visible: false, redemptionId: "", handler: "", reason: "" });

function reverseRedemption(id: string) {
  Object.assign(rdDialog, { visible: true, redemptionId: id, handler: "", reason: "" });
}

function submitRedemptionCorrection() {
  const r = store.reverseRedemption(rdDialog.redemptionId, rdDialog.handler, rdDialog.reason);
  if (!r.ok) {
    ElMessage.error(r.error);
    return;
  }
  ElMessage.success("核销已撤销并回补余次，旧值保留在新版本中");
  rdDialog.visible = false;
}
</script>

<template>
  <div class="history">
    <el-card shadow="never" class="block">
      <template #header><h3>班次列表（{{ shifts.length }}）</h3></template>
      <el-table :data="shifts" size="small" highlight-current-row @row-click="(row: Shift) => (selectedId = row.id)">
        <el-table-column prop="businessDate" label="营业日" width="110" />
        <el-table-column prop="kind" label="班次" width="70" />
        <el-table-column prop="opener" label="开班人" width="90" />
        <el-table-column label="券包(领/用/废/余)" width="150">
          <template #default="{ row }">
            {{ row.pack.received }}/{{ row.pack.used }}/{{ row.pack.voided }}/{{ packBalance(row.pack) }}
          </template>
        </el-table-column>
        <el-table-column label="电子核销" width="80">
          <template #default="{ row }">{{ store.electronicCount(row.id) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status).type" size="small">{{ statusTag(row.status).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="差额/说明" min-width="200">
          <template #default="{ row }">
            <span v-if="row.discrepancy" class="bad">
              差额 {{ row.discrepancy.diff > 0 ? "+" : "" }}{{ row.discrepancy.diff }}
              （{{ row.discrepancy.handler }}：{{ row.discrepancy.reason }}）
            </span>
            <span v-else-if="store.handoverDiff(row) !== 0 && row.status !== 'open'" class="bad">
              差额 {{ store.handoverDiff(row) }}
            </span>
            <span v-else class="ok">一致</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="selected" shadow="never" class="block grow">
      <template #header>
        <div class="shift-head">
          <h3>{{ selected.businessDate }} {{ selected.kind }} · 核销与版本</h3>
          <el-button v-if="selected.status === 'closed'" type="warning" plain @click="openPackDialog(selected)">
            更正券包（带原因版本）
          </el-button>
        </div>
      </template>

      <h4>本班核销台账</h4>
      <el-table :data="store.redemptionsOf(selected.id)" size="small" max-height="200" empty-text="无核销记录">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ new Date(row.at).toLocaleString("zh-CN") }}</template>
        </el-table-column>
        <el-table-column prop="cardCode" label="卡号" width="150" />
        <el-table-column prop="plate" label="车牌" width="110" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.reversed ? 'danger' : 'success'" size="small">
              {{ row.reversed ? "已撤销" : "有效" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="warning"
              size="small"
              :disabled="row.reversed || selected.status !== 'closed'"
              @click="reverseRedemption(row.id)"
            >
              撤销并留版本
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <h4>版本留痕（旧值永久保留）</h4>
      <el-timeline>
        <el-timeline-item
          v-for="v in store.versionsOf(selected.id)"
          :key="v.id"
          :timestamp="new Date(v.at).toLocaleString('zh-CN')"
          placement="top"
        >
          <el-card shadow="never" size="small">
            <div class="ver-head">
              <el-tag size="small">{{ versionKindText[v.kind] ?? v.kind }}</el-tag>
              <strong>{{ v.handler }}</strong>
            </div>
            <p class="ver-reason">{{ v.reason }}</p>
            <div class="ver-diff">
              <div class="ver-col">
                <span class="ver-label">旧值</span>
                <pre>{{ JSON.stringify(v.before, null, 2) }}</pre>
              </div>
              <div class="ver-arrow">→</div>
              <div class="ver-col">
                <span class="ver-label">新值</span>
                <pre>{{ JSON.stringify(v.after, null, 2) }}</pre>
              </div>
            </div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-if="store.versionsOf(selected.id).length === 0" description="该班次暂无版本" :image-size="60" />
    </el-card>

    <!-- 券包更正弹窗 -->
    <el-dialog v-model="packDialog.visible" title="关班后更正券包（另建带原因版本）" width="480px">
      <el-alert type="warning" :closable="false" show-icon title="班次已冻结，本次更正不会覆盖旧值，将新增版本记录。" class="hold-banner" />
      <el-form label-position="top">
        <el-form-item label="领用"><el-input-number v-model="packDialog.received" :min="0" /></el-form-item>
        <el-form-item label="使用"><el-input-number v-model="packDialog.used" :min="0" /></el-form-item>
        <el-form-item label="作废"><el-input-number v-model="packDialog.voided" :min="0" /></el-form-item>
        <el-form-item label="更正人" required><el-input v-model="packDialog.handler" /></el-form-item>
        <el-form-item label="更正原因" required>
          <el-input v-model="packDialog.reason" type="textarea" :rows="3" placeholder="如：交接班点错数，实物余券复核为 6 张" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="packDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="submitPackCorrection">确认更正</el-button>
      </template>
    </el-dialog>

    <!-- 核销撤销弹窗 -->
    <el-dialog v-model="rdDialog.visible" title="关班后撤销核销（另建带原因版本）" width="480px">
      <el-alert type="warning" :closable="false" show-icon title="撤销后回补次卡余次，原核销记录保留并标记为已撤销。" class="hold-banner" />
      <el-form label-position="top">
        <el-form-item label="更正人" required><el-input v-model="rdDialog.handler" /></el-form-item>
        <el-form-item label="更正原因" required>
          <el-input v-model="rdDialog.reason" type="textarea" :rows="3" placeholder="如：误扫前车车牌，车主未实际洗车" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rdDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="submitRedemptionCorrection">确认撤销</el-button>
      </template>
    </el-dialog>
  </div>
</template>
