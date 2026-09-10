<template>
  <span v-if="isTop || isEssence || isPending || isRejected" class="status">
    <span v-if="isTop" class="bs top">置顶</span>
    <span v-if="isEssence" class="bs ess">精华</span>
    <span v-if="isResubmitted" class="bs resub" title="该帖曾被驳回，已修改并重新提交，等待再次审核">🔁 待重审</span>
    <span v-else-if="isPending" class="bs pending">⏳ 待审核</span>
    <span v-if="isRejected" class="bs rejected" :title="rejectReason || ''">✖ 已驳回</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  isTop: Boolean,
  isEssence: Boolean,
  // 审核状态提示：2=待审核（若带重提时间 resubmitAt 则为「待重审」）；1 且带驳回理由=已驳回
  status: { type: Number, default: 0 },
  rejectReason: { type: String, default: '' },
  resubmitAt: { type: String, default: '' }
})

const isPending = computed(() => props.status === 2)
const isResubmitted = computed(() => props.status === 2 && !!props.resubmitAt)
const isRejected = computed(() => props.status === 1 && !!props.rejectReason)
</script>

<style scoped>
.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
}
/* 帖子状态角标：与标题同一行、前缀展示，不遮挡封面 */
.bs {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  line-height: 1.4;
  letter-spacing: 0.5px;
}
.bs.top {
  background: rgba(25, 227, 194, 0.15);
  color: var(--brand-2);
  border: 1px solid rgba(25, 227, 194, 0.4);
}
.bs.ess {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid rgba(255, 176, 32, 0.4);
}
.bs.pending {
  background: rgba(64, 158, 255, 0.15);
  color: #79bbff;
  border: 1px solid rgba(64, 158, 255, 0.45);
}
.bs.resub {
  background: rgba(127, 90, 240, 0.16);
  color: #b49aff;
  border: 1px solid rgba(127, 90, 240, 0.5);
}
.bs.rejected {
  background: rgba(245, 108, 108, 0.15);
  color: #f89898;
  border: 1px solid rgba(245, 108, 108, 0.5);
  cursor: help;
}
</style>
