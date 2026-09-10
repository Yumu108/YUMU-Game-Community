<template>
  <span class="board-tag">{{ text }}</span>
</template>

<script setup>
defineProps({
  text: { type: String, default: '' }
})
</script>

<style scoped>
/* 板块分类标签：弱色描边，与状态角标在视觉上区分 */
.board-tag {
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--t2);
  background: var(--bg-3);
  border: 1px solid var(--border);
  padding: 2px 9px;
  border-radius: 6px;
  line-height: 1.4;
}
</style>
