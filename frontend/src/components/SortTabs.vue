<template>
  <div class="tabs" :class="{ disabled }">
    <button
      v-for="t in tabs"
      :key="t.key"
      class="tab"
      :class="{ active: modelValue === t.key }"
      :disabled="disabled"
      @click="select(t.key)"
    >
      {{ t.label }}
    </button>
  </div>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: String, default: 'latest' },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

// 排序维度：
//   all     —— 全部该游戏可见帖（不分页，一次性返回）
//   latest  —— 最新发布（置顶优先 + 时间倒序；一页）
//   hot     —— 综合分 = 浏览 + 点赞*2 + 评论*3 + 收藏（一页）
//   essence —— 仅精华帖（不分页）
//   reply   —— 评论数倒序（一页）
//   favorite —— 收藏数倒序（一页）
const tabs = [
  { key: 'all', label: '全部' },
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '🔥 热门' },
  { key: 'essence', label: '⭐ 精华' },
  { key: 'reply', label: '💬 最多回复' },
  { key: 'favorite', label: '🔖 最多收藏' }
]

function select(key) {
  if (props.disabled) return
  emit('update:modelValue', key)
}
</script>

<style scoped>
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.tab {
  border: none;
  background: transparent;
  color: var(--t2);
  font-size: 13.5px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
}
.tab:hover {
  color: var(--t1);
  background: var(--bg-3);
}
.tab.active {
  color: #fff;
  background: var(--brand);
  box-shadow: 0 3px 12px rgba(124, 92, 255, 0.35);
}
.tabs.disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}
.tabs.disabled .tab.active {
  background: var(--bg-3);
  color: var(--t2);
  box-shadow: none;
}
</style>
