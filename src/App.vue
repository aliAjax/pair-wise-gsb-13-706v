<script setup lang="ts">
// 页面层：交班台外壳（仅负责布局与页签，规则全部在 rules/，状态全部在 storage/）
import { computed, ref } from "vue";
import { useHandoverStore } from "./storage/handoverStore";
import ShiftDesk from "./components/ShiftDesk.vue";
import CardPanel from "./components/CardPanel.vue";
import ShiftHistory from "./components/ShiftHistory.vue";
import ConflictBanner from "./components/ConflictBanner.vue";

const store = useHandoverStore();
const tab = ref<"desk" | "cards" | "history">("desk");

const stats = computed(() => ({
  cards: store.cards.length,
  active: store.cards.filter((c) => c.used < c.total && c.expiresOn >= new Date().toISOString().slice(0, 10)).length,
  open: store.shifts.filter((s) => s.status !== "closed").length,
  closed: store.shifts.filter((s) => s.status === "closed").length,
  versions: store.versions.length,
  conflicts: store.conflicts.length
}));
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">洗车业务 · 班次交接</p>
          <h1>洗车次卡与券包交班台</h1>
          <p class="subtitle">
            次卡登记车牌、总次数、有效期末并逐次核销；每班登记纸质券领用、使用、作废；
            电子核销与券包不一致整班待处理，处理人写清原因方可关班；关班冻结，更正另建带原因版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">有效卡 {{ stats.active }}/{{ stats.cards }}</span>
          <span class="tag">未关班 {{ stats.open }}</span>
          <span class="tag">已关班 {{ stats.closed }}</span>
          <span class="tag">版本 {{ stats.versions }}</span>
          <span :class="['tag', stats.conflicts ? 'tag-bad' : 'tag-ok']">冲突 {{ stats.conflicts }}</span>
        </div>
      </header>

      <ConflictBanner />

      <el-tabs v-model="tab" class="tabs" stretch>
        <el-tab-pane label="交班台" name="desk" />
        <el-tab-pane label="次卡登记" name="cards" />
        <el-tab-pane label="班次与版本" name="history" />
      </el-tabs>

      <section class="pane">
        <ShiftDesk v-if="tab === 'desk'" />
        <CardPanel v-else-if="tab === 'cards'" />
        <ShiftHistory v-else />
      </section>

      <footer class="foot">
        数据保存在浏览器 localStorage；刷新后自动对账。四层分离：
        <code>src/data</code> 数据 · <code>src/rules</code> 规则 · <code>src/storage</code> 存储 · <code>src/components</code> 页面
      </footer>
    </div>
  </main>
</template>
