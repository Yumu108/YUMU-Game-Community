<template>
  <view class="tile" :style="tileStyle">
    <!-- 无 alt 见 PostCard 里的说明：H5 端 `<image>` 会丢掉 `alt`，两端各给一份 -->
    <image
      v-if="cover"
      class="tile__img"
      :src="cover"
      mode="aspectFill"
      :alt="gameName"
      role="img"
      :aria-label="gameName"
      @error="onImgError"
    />
    <text v-else class="tile__letter" :style="{ color: t.fg }">{{ t.letter }}</text>
  </view>
</template>

<script setup>
/**
 * 游戏色块。
 *
 * 🚨 线上 18 款游戏的 `cover` 全是 null，所以**默认形态就是首字色块**，
 *   有图才显示图 —— 反过来写会让所有游戏卡都变成空白。
 */
import { computed, ref, watch } from 'vue'
import { gameTile, resolveImage } from '../utils/format'

const props = defineProps({
  game: { type: Object, default: () => ({}) },
  size: { type: String, default: 'md' } // sm | md | lg
})

const t = computed(() => gameTile(props.game))
const coverUrl = ref('')

watch(
  () => props.game && props.game.cover,
  (v) => {
    coverUrl.value = resolveImage(v)
  },
  { immediate: true }
)

const cover = computed(() => coverUrl.value)
/** 有图时给读屏的可读名（无图时走首字色块，那段文本本身就可读） */
const gameName = computed(() => (props.game && props.game.name) || '游戏封面')

function onImgError() {
  // 图挂了就退回首字色块，不留空白
  coverUrl.value = ''
}

const sizeMap = { sm: 72, md: 96, lg: 120 }
const px = computed(() => sizeMap[props.size] || 96)

const tileStyle = computed(() => {
  const radius = Math.round(px.value * 0.2)
  return {
    width: `${px.value}rpx`,
    height: `${px.value}rpx`,
    borderRadius: `${radius}rpx`,
    background: t.value.bg
  }
})
</script>

<style scoped>
.tile {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.tile__img {
  width: 100%;
  height: 100%;
}
.tile__letter {
  font-weight: 600;
  font-size: 40rpx;
}
</style>
