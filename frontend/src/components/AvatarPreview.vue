<template>
  <div class="avatar-preview" :style="wrapStyle">
    <el-image
      v-if="src"
      :src="src"
      :preview-src-list="[src]"
      :initial-index="0"
      fit="cover"
      class="preview-img"
      hide-on-click-modal
      :style="imgStyle"
    />
    <el-avatar v-else :size="size" :style="avaStyle" @click="dialogVisible = true">
      {{ initial }}
    </el-avatar>

    <el-dialog v-model="dialogVisible" width="280px" align-center :show-close="false" class="ava-dialog">
      <div class="big-ava-wrap">
        <el-avatar :size="previewSize">{{ initial }}</el-avatar>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  size: { type: Number, default: 40 },
  src: { type: String, default: '' },
  name: { type: String, default: '?' },
  previewSize: { type: Number, default: 120 }
})

const dialogVisible = ref(false)
const initial = computed(() => (props.name || '?').charAt(0))

const wrapStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: '50%',
  overflow: 'hidden',
  flexShrink: 0,
  cursor: 'pointer'
}))

const imgStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: '50%',
  display: 'block'
}))

const avaStyle = computed(() => ({
  fontSize: `${Math.max(14, props.size * 0.4)}px`,
  fontWeight: 700,
  background: 'var(--brand-soft, rgba(124, 92, 255, 0.14))',
  color: 'var(--brand, #7c5cff)',
  border: '1px solid var(--border, rgba(255,255,255,0.08))'
}))
</script>

<style scoped>
.preview-img :deep(img) {
  border-radius: 50%;
}
.big-ava-wrap {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}
</style>
