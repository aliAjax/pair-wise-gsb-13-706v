<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { ElMessage } from "element-plus";
import { useHandoverStore } from "./stores/handover";
import {
  cardStatus,
  electronicCount,
  latestVersion,
  remainingCoupons,
  remainingTimes,
  shiftDifference,
  todayStr,
  versionsOf,
} from "./domain/rules";
import type { Result, Shift } from "./domain/types";

const store = useHandoverStore();

// ---------- 次卡登记 ----------
const cardForm = reactive({
  plate: "",
  totalTimes: 10,
  validUntil: todayStr(new Date(Date.now() + 30 * 86400000)),
});

function submitCard() {
  const result = store.registerCard(cardForm.plate, cardForm.totalTimes, cardForm.validUntil);
  notify(result);
  if (result.ok) cardForm.plate = "";
}

// ---------- 次卡核销（提交键幂等） ----------
function newRequestKey(): string {
  return crypto.randomUUID();
}

const redeemForm = reactive({ cardId: "", plate: "", requestKey: newRequestKey() });

watch(
  () => redeemForm.cardId,
  (cardId) => {
    const card = store.cards.find((item) => item.id === cardId);
    redeemForm.plate = card?.plate ?? "";
    redeemForm.requestKey = newRequestKey();
  }
);

function submitRedemption() {
  if (!redeemForm.cardId) {
    ElMessage.error("请选择要核销的次卡");
    return;
  }
  // 同一提交键重复点击只保留首次；换键或换卡后才算下一笔
  notify(store.redeem(redeemForm.cardId, redeemForm.plate, redeemForm.requestKey));
}

// ---------- 开班 ----------
function defaultShiftLabel(): string {
  const hour = new Date().getHours();
  const name = hour < 11 ? "早班" : hour < 19 ? "中班" : "晚班";
  return `${todayStr()} ${name}`;
}

const openForm = reactive({ label: defaultShiftLabel(), received: 50 });

function submitOpenShift() {
  notify(store.openShift(openForm.label, openForm.received));
}

// ---------- 券包（当前班） ----------
const activeVersion = computed(() =>
  store.activeShift ? latestVersion(store.couponVersions, store.activeShift.id) : undefined
);

const couponForm = reactive({ received: 0, used: 0, voided: 0 });

watch(
  activeVersion,
  (version) => {
    if (version) {
      couponForm.received = version.received;
      couponForm.used = version.used;
      couponForm.voided = version.voided;
    }
  },
  { immediate: true }
);

const activeElectronic = computed(() =>
  store.activeShift ? electronicCount(store.redemptions, store.activeShift.id) : 0
);
const liveRemaining = computed(() => couponForm.received - couponForm.used - couponForm.voided);
const liveDifference = computed(() => activeElectronic.value - couponForm.used);

function saveCoupon() {
  if (!store.activeShift) return;
  notify(store.saveCouponPack(store.activeShift.id, couponForm.received, couponForm.used, couponForm.voided));
}

function closeActiveShift() {
  if (!store.activeShift) return;
  const saved = store.saveCouponPack(
    store.activeShift.id,
    couponForm.received,
    couponForm.used,
    couponForm.voided
  );
  if (!saved.ok) {
    notify(saved);
    return;
  }
  notify(store.requestClose(store.activeShift.id));
}

// ---------- 班次操作 ----------
function versionOfShift(shiftId: string) {
  return latestVersion(store.couponVersions, shiftId);
}
function electronicOf(shiftId: string) {
  return electronicCount(store.redemptions, shiftId);
}
function differenceOf(shiftId: string) {
  return shiftDifference(store.couponVersions, store.redemptions, shiftId);
}
function remainingOf(shiftId: string) {
  const version = versionOfShift(shiftId);
  return version ? remainingCoupons(version) : 0;
}

const resolveDialog = reactive({ visible: false, shiftId: "", handler: "", note: "" });
function openResolve(shift: Shift) {
  Object.assign(resolveDialog, { visible: true, shiftId: shift.id, handler: "", note: "" });
}
function submitResolve() {
  const result = store.resolveClose(resolveDialog.shiftId, resolveDialog.handler, resolveDialog.note);
  notify(result);
  if (result.ok) resolveDialog.visible = false;
}

const correctDialog = reactive({
  visible: false,
  shiftId: "",
  received: 0,
  used: 0,
  voided: 0,
  reason: "",
});
function openCorrect(shift: Shift) {
  const version = versionOfShift(shift.id);
  Object.assign(correctDialog, {
    visible: true,
    shiftId: shift.id,
    received: version?.received ?? 0,
    used: version?.used ?? 0,
    voided: version?.voided ?? 0,
    reason: "",
  });
}
function submitCorrect() {
  const result = store.correctCouponPack(
    correctDialog.shiftId,
    correctDialog.received,
    correctDialog.used,
    correctDialog.voided,
    correctDialog.reason
  );
  notify(result);
  if (result.ok) correctDialog.visible = false;
}

const historyDialog = reactive({ visible: false, shiftId: "" });
const historyRows = computed(() => versionsOf(store.couponVersions, historyDialog.shiftId));
function openHistory(shift: Shift) {
  Object.assign(historyDialog, { visible: true, shiftId: shift.id });
}

// ---------- 展示辅助 ----------
const metrics = computed(() => [
  { label: "有效次卡", value: store.cards.filter((card) => cardStatus(card) === "有效").length },
  { label: "本班电子核销", value: store.activeShift ? activeElectronic.value : "—" },
  { label: "本班余券", value: activeVersion.value ? remainingCoupons(activeVersion.value) : "—" },
  { label: "待处理班次", value: store.pendingShifts.length },
]);

function notify(result: Result) {
  if (result.duplicated) ElMessage.warning(result.message);
  else if (result.ok) ElMessage.success(result.message);
  else ElMessage.error(result.message);
}

function shiftTagType(status: string) {
  return status === "进行中" ? "success" : status === "待处理" ? "warning" : "info";
}
function cardTagType(status: string) {
  return status === "有效" ? "success" : status === "已用尽" ? "info" : "danger";
}
function shortKey(key: string) {
  return key.length > 8 ? `${key.slice(0, 8)}…` : key;
}
function shiftLabelOf(shiftId: string) {
  return store.shifts.find((shift) => shift.id === shiftId)?.label ?? shiftId;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDiff(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 加油站洗车业务</p>
          <h1>洗车次卡与券包交班台</h1>
          <p class="subtitle">
            次卡登记车牌、总次数与有效期末，同车牌仅允许一张有效卡；核销校验过期、次数与车牌，重复提交只保留首次。
            每班登记纸质券领用、使用与作废，交班余券 = 领用 − 使用 − 作废；电子核销与券包不一致时整班停在待处理，
            处理人写清原因后方可关班；关班后冻结核销与券包，更正另建带原因的版本并保留旧值。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">Element Plus</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="metric in metrics" :key="metric.label" class="metric">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
        </article>
      </section>

      <el-alert
        v-if="store.conflicts.length"
        type="error"
        :closable="false"
        class="conflict-alert"
        :title="`存在 ${store.conflicts.length} 个班次电子核销与券包不一致，详见右侧「冲突清单」`"
      />

      <section class="workspace">
        <div class="side">
          <section class="panel">
            <h2>次卡登记</h2>
            <div class="form-grid">
              <label>
                车牌号
                <input v-model="cardForm.plate" placeholder="如 京A12345" />
              </label>
              <label>
                总次数
                <input v-model.number="cardForm.totalTimes" type="number" min="1" />
              </label>
              <label>
                有效期末
                <el-date-picker
                  v-model="cardForm.validUntil"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="选择日期"
                  style="width: 100%"
                />
              </label>
              <button type="button" @click="submitCard">登记次卡</button>
            </div>
          </section>

          <section class="panel">
            <h2>次卡核销</h2>
            <el-alert
              v-if="!store.activeShift"
              type="warning"
              :closable="false"
              class="panel-alert"
              title="当前无进行中的班次，核销已冻结，请先开班"
            />
            <div class="form-grid">
              <label>
                次卡
                <select v-model="redeemForm.cardId">
                  <option value="">请选择次卡</option>
                  <option v-for="card in store.cards" :key="card.id" :value="card.id">
                    {{ card.id }} ｜ {{ card.plate }} ｜ 剩 {{ remainingTimes(card) }}/{{ card.totalTimes }} 次 ｜ {{ cardStatus(card) }}
                  </option>
                </select>
              </label>
              <label>
                车牌号（须与卡登记车牌一致）
                <input v-model="redeemForm.plate" placeholder="核销车辆车牌" />
              </label>
              <label>
                提交键（重复提交只保留首次）
                <div class="key-row">
                  <input v-model="redeemForm.requestKey" readonly />
                  <button type="button" class="secondary" @click="redeemForm.requestKey = newRequestKey()">换键</button>
                </div>
              </label>
              <button type="button" :disabled="!store.activeShift" @click="submitRedemption">核销一次</button>
            </div>
          </section>

          <section v-if="store.activeShift" class="panel">
            <h2>券包登记 · {{ store.activeShift.label }}</h2>
            <div class="form-grid">
              <div class="triple">
                <label>
                  领用
                  <input v-model.number="couponForm.received" type="number" min="0" />
                </label>
                <label>
                  使用
                  <input v-model.number="couponForm.used" type="number" min="0" />
                </label>
                <label>
                  作废
                  <input v-model.number="couponForm.voided" type="number" min="0" />
                </label>
              </div>
              <div class="stat-grid">
                <div class="stat"><span>交班余券</span><strong>{{ liveRemaining }}</strong></div>
                <div class="stat"><span>电子核销</span><strong>{{ activeElectronic }}</strong></div>
                <div class="stat">
                  <span>差额</span>
                  <strong :class="liveDifference === 0 ? 'ok-text' : 'danger-text'">{{ fmtDiff(liveDifference) }}</strong>
                </div>
              </div>
              <p class="hint">余券 = 领用 − 使用 − 作废；差额 = 电子核销 − 券包使用，差额为 0 才能直接关班，否则整班停在待处理。</p>
              <div class="actions">
                <button type="button" class="secondary" @click="saveCoupon">保存券包</button>
                <button type="button" @click="closeActiveShift">交班检查并关班</button>
              </div>
            </div>
          </section>

          <section v-else class="panel">
            <h2>开班</h2>
            <div class="form-grid">
              <label>
                班次名称
                <input v-model="openForm.label" />
              </label>
              <label>
                纸质券领用
                <input v-model.number="openForm.received" type="number" min="0" />
              </label>
              <button type="button" @click="submitOpenShift">开班并登记券包</button>
            </div>
          </section>
        </div>

        <section class="panel ledger">
          <el-tabs>
            <el-tab-pane label="班次交接">
              <div class="record-grid">
                <article v-for="shift in store.shifts" :key="shift.id" class="record">
                  <div class="record-head">
                    <p class="record-title">{{ shift.label }}</p>
                    <el-tag :type="shiftTagType(shift.status)" size="small">{{ shift.status }}</el-tag>
                  </div>
                  <div class="stat-grid six">
                    <div class="stat"><span>领用</span><strong>{{ versionOfShift(shift.id)?.received ?? 0 }}</strong></div>
                    <div class="stat"><span>使用</span><strong>{{ versionOfShift(shift.id)?.used ?? 0 }}</strong></div>
                    <div class="stat"><span>作废</span><strong>{{ versionOfShift(shift.id)?.voided ?? 0 }}</strong></div>
                    <div class="stat"><span>余券</span><strong>{{ remainingOf(shift.id) }}</strong></div>
                    <div class="stat"><span>电子核销</span><strong>{{ electronicOf(shift.id) }}</strong></div>
                    <div class="stat">
                      <span>差额</span>
                      <strong :class="differenceOf(shift.id) === 0 ? 'ok-text' : 'danger-text'">{{ fmtDiff(differenceOf(shift.id)) }}</strong>
                    </div>
                  </div>
                  <p v-if="shift.handler" class="note">处理人：{{ shift.handler }} ｜ 原因：{{ shift.handleNote }}</p>
                  <p class="muted">
                    开班 {{ fmtTime(shift.openedAt) }}
                    <template v-if="shift.closedAt"> ｜ 关班 {{ fmtTime(shift.closedAt) }}</template>
                  </p>
                  <div class="actions">
                    <button v-if="shift.status === '待处理'" type="button" @click="openResolve(shift)">处理并关班</button>
                    <button v-if="shift.status === '已关班'" type="button" class="secondary" @click="openCorrect(shift)">更正券包（新版本）</button>
                    <button type="button" class="secondary" @click="openHistory(shift)">版本历史</button>
                  </div>
                </article>
                <div v-if="store.shifts.length === 0" class="empty">暂无班次</div>
              </div>
            </el-tab-pane>

            <el-tab-pane label="次卡台账">
              <el-table :data="store.cards" size="small" max-height="520">
                <el-table-column prop="id" label="卡号" width="90" />
                <el-table-column prop="plate" label="车牌" width="110" />
                <el-table-column prop="totalTimes" label="总次数" width="70" align="right" />
                <el-table-column label="剩余" width="70" align="right">
                  <template #default="{ row }">{{ remainingTimes(row) }}</template>
                </el-table-column>
                <el-table-column prop="validUntil" label="有效期末" width="110" />
                <el-table-column label="状态" width="80">
                  <template #default="{ row }">
                    <el-tag :type="cardTagType(cardStatus(row))" size="small">{{ cardStatus(row) }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="核销流水">
              <el-table :data="store.redemptions" size="small" max-height="520">
                <el-table-column label="时间" width="110">
                  <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column prop="cardId" label="卡号" width="90" />
                <el-table-column prop="plate" label="车牌" width="100" />
                <el-table-column label="班次" min-width="130">
                  <template #default="{ row }">{{ shiftLabelOf(row.shiftId) }}</template>
                </el-table-column>
                <el-table-column label="提交键" width="100">
                  <template #default="{ row }">{{ shortKey(row.requestKey) }}</template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <el-tab-pane :label="`冲突清单 (${store.conflicts.length})`">
              <el-table :data="store.conflicts" size="small" empty-text="账实一致，无冲突">
                <el-table-column prop="shiftLabel" label="班次" min-width="120" />
                <el-table-column label="状态" width="80">
                  <template #default="{ row }">
                    <el-tag :type="shiftTagType(row.shiftStatus)" size="small">{{ row.shiftStatus }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="electronic" label="电子核销" width="80" align="right" />
                <el-table-column prop="couponUsed" label="券包使用" width="80" align="right" />
                <el-table-column label="差额" width="70" align="right">
                  <template #default="{ row }">
                    <span class="danger-text">{{ fmtDiff(row.difference) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="涉及车牌 / 卡号" min-width="180">
                  <template #default="{ row }">
                    <el-tag v-for="ref in row.cards" :key="ref.cardId + ref.plate" size="small" class="plate-tag">
                      {{ ref.plate }} ｜ {{ ref.cardId }}
                    </el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </section>
      </section>

      <el-dialog v-model="resolveDialog.visible" title="处理差异并关班" width="420px">
        <div class="form-grid">
          <label>
            处理人
            <input v-model="resolveDialog.handler" placeholder="填写处理人姓名" />
          </label>
          <label>
            差异原因
            <textarea v-model="resolveDialog.note" placeholder="写清电子核销与券包不一致的原因" />
          </label>
        </div>
        <template #footer>
          <button type="button" class="secondary" @click="resolveDialog.visible = false">取消</button>
          <button type="button" @click="submitResolve">确认关班</button>
        </template>
      </el-dialog>

      <el-dialog v-model="correctDialog.visible" title="更正券包（另建版本，保留旧值）" width="420px">
        <div class="form-grid">
          <div class="triple">
            <label>
              领用
              <input v-model.number="correctDialog.received" type="number" min="0" />
            </label>
            <label>
              使用
              <input v-model.number="correctDialog.used" type="number" min="0" />
            </label>
            <label>
              作废
              <input v-model.number="correctDialog.voided" type="number" min="0" />
            </label>
          </div>
          <label>
            更正原因
            <textarea v-model="correctDialog.reason" placeholder="必填，说明更正依据" />
          </label>
        </div>
        <template #footer>
          <button type="button" class="secondary" @click="correctDialog.visible = false">取消</button>
          <button type="button" @click="submitCorrect">生成新版本</button>
        </template>
      </el-dialog>

      <el-dialog v-model="historyDialog.visible" title="券包版本历史" width="640px">
        <el-table :data="historyRows" size="small">
          <el-table-column label="版本" width="60">
            <template #default="{ row }">V{{ row.version }}</template>
          </el-table-column>
          <el-table-column prop="received" label="领用" width="70" align="right" />
          <el-table-column prop="used" label="使用" width="70" align="right" />
          <el-table-column prop="voided" label="作废" width="70" align="right" />
          <el-table-column label="余券" width="70" align="right">
            <template #default="{ row }">{{ remainingCoupons(row) }}</template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="140" />
          <el-table-column label="时间" width="110">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </el-dialog>
    </div>
  </main>
</template>
