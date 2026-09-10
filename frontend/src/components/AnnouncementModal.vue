<template>
  <transition name="anno-fade">
    <div
      v-if="visible"
      class="anno-modal"
      :class="{ 'is-top': currentIsTop }"
      @click.self="onMaskClick"
    >
      <div class="anno-card">
        <!-- 9-08 强化：置顶公告加红色「重要」角标 + 呼吸光晕 -->
        <div v-if="currentIsTop" class="anno-pin-badge">
          <el-icon><StarFilled /></el-icon>
          <span>重要公告</span>
        </div>

        <div class="anno-head">
          <div class="anno-title">
            <span class="anno-title-icon">{{ currentIsTop ? '📌' : '📢' }}</span>
            <span>{{ currentIsTop ? '重要公告' : '社区公告' }}</span>
          </div>
          <el-button class="anno-close" size="small" text @click="close">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>

        <!-- 9-08 强化：进度条显示轮播进度 -->
        <div v-if="items.length > 1" class="anno-progress">
          <div
            v-for="(it, i) in items"
            :key="i"
            class="anno-progress-bar"
            :class="{ active: i === currentIdx, top: it.isTop }"
            @click="currentIdx = i"
          >
            <div
              v-if="i === currentIdx && !paused"
              class="anno-progress-fill"
              :class="{ top: it.isTop }"
              :style="{ animationDuration: interval + 'ms' }"
            />
          </div>
        </div>

        <div class="anno-marquee" :class="{ paused: paused }">
          <div v-if="!items.length" class="anno-empty">暂无公告</div>
          <transition v-else name="anno-slide" mode="out-in">
            <div
              :key="currentIdx"
              class="anno-slide"
              @mouseenter="paused = true"
              @mouseleave="paused = false"
            >
              <div class="anno-item-title">{{ items[currentIdx].title }}</div>
              <div class="anno-item-content">{{ items[currentIdx].content }}</div>
              <div class="anno-item-meta num">
                <span v-if="items[currentIdx].isTop" class="anno-meta-tag">📌 置顶</span>
                <span>{{ items[currentIdx].creatorName }} · {{ items[currentIdx].createdAt }}</span>
              </div>
            </div>
          </transition>
        </div>

        <div v-if="items.length > 1" class="anno-dots">
          <span
            v-for="(it, i) in items"
            :key="i"
            class="dot"
            :class="{ on: i === currentIdx, top: it.isTop }"
            :title="it.isTop ? '📌 置顶公告' : ''"
            @click="currentIdx = i"
          />
        </div>

        <div class="anno-foot">
          <el-button size="small" plain @click="close">我知道了</el-button>
          <el-button size="small" type="primary" plain @click="goAll">
            查看全部公告 ({{ items.length }})
          </el-button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Close, StarFilled } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  /** 自动切换间隔（毫秒）；<=0 表示不自动切换 */
  interval: { type: Number, default: 4500 }
})
const emit = defineEmits(['update:visible', 'close', 'view-all'])

const router = useRouter()
const currentIdx = ref(0)
const paused = ref(false)
let timer = null

// 9-08 强化：当前条目是否为置顶（用于驱动整张弹窗的红橙风格）
const currentIsTop = computed(() => !!props.items[currentIdx.value]?.isTop)

watch(
  () => props.items,
  (list) => {
    // 进入时优先展示置顶公告（从最高优先级开始轮播）
    const firstTop = list.findIndex((a) => a.isTop)
    currentIdx.value = firstTop >= 0 ? firstTop : 0
  },
  { immediate: true }
)

function startTimer() {
  stopTimer()
  if (props.interval > 0 && props.items.length > 1) {
    timer = setInterval(() => {
      if (!paused.value) {
        currentIdx.value = (currentIdx.value + 1) % props.items.length
      }
    }, props.interval)
  }
}
function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) startTimer()
    else stopTimer()
  }
)

onUnmounted(stopTimer)

function close() {
  emit('update:visible', false)
  emit('close')
}
function onMaskClick() {
  // 点击遮罩不关闭（强制用户点「我知道了」或「查看全部公告」）
}
function goAll() {
  emit('view-all')
  close()
  router.push('/announcements')
}
</script>

<style scoped>
.anno-modal {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  backdrop-filter: blur(4px);
}
/* ★ 9-08：置顶公告时遮罩更深一档 + 背景红橙光晕，传达「这是重要的事」 */
.anno-modal.is-top {
  background:
    radial-gradient(circle at 50% 30%, rgba(255, 80, 60, 0.18), transparent 60%),
    rgba(0, 0, 0, 0.6);
}

.anno-card {
  position: relative;
  width: min(720px, 94vw);
  background: linear-gradient(160deg, #1f1b3d 0%, #14273a 100%);
  border: 1px solid rgba(246, 196, 83, 0.35);
  border-radius: 16px;
  box-shadow:
    0 18px 60px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
  color: #f3f4f6;
}
/* ★ 9-08：置顶公告整张卡变红橙调 + 呼吸光晕（box-shadow 脉动） */
.anno-modal.is-top .anno-card {
  background: linear-gradient(160deg, #3a1f1d 0%, #40180e 50%, #2a1233 100%);
  border-color: rgba(255, 110, 90, 0.55);
  box-shadow:
    0 0 0 1px rgba(255, 130, 100, 0.15) inset,
    0 0 36px rgba(255, 90, 60, 0.35),
    0 0 90px rgba(255, 70, 50, 0.18),
    0 18px 60px rgba(0, 0, 0, 0.55);
  animation: anno-pulse 2.4s ease-in-out infinite;
}
@keyframes anno-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 1px rgba(255, 130, 100, 0.15) inset,
      0 0 32px rgba(255, 90, 60, 0.30),
      0 0 80px rgba(255, 70, 50, 0.14),
      0 18px 60px rgba(0, 0, 0, 0.55);
  }
  50% {
    box-shadow:
      0 0 0 1px rgba(255, 130, 100, 0.22) inset,
      0 0 50px rgba(255, 90, 60, 0.55),
      0 0 120px rgba(255, 70, 50, 0.28),
      0 18px 60px rgba(0, 0, 0, 0.55);
  }
}

/* ★ 9-08：置顶公告右上角红色「重要」角标 */
.anno-pin-badge {
  position: absolute;
  top: 14px;
  right: 56px; /* 避开右上角的关闭按钮 */
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: linear-gradient(90deg, #ff5b4e, #ff8a3c);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(255, 90, 60, 0.45);
  z-index: 2;
}
.anno-pin-badge .el-icon {
  font-size: 13px;
}

.anno-head {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(90deg, rgba(246, 196, 83, 0.12), transparent);
}
/* 置顶公告头部背景换红橙 */
.anno-modal.is-top .anno-head {
  background: linear-gradient(90deg, rgba(255, 100, 80, 0.18), transparent);
  border-bottom-color: rgba(255, 110, 90, 0.3);
}

.anno-title {
  font-size: 16px;
  font-weight: 800;
  color: #f6c453;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.anno-title-icon {
  font-size: 17px;
}
.anno-modal.is-top .anno-title {
  color: #ff9d6e;
}

.anno-close {
  margin-left: auto;
  color: #9ca3af;
}
.anno-close:hover {
  color: #fff;
}

/* ★ 9-08：进度条（替代原来单纯的圆点） */
.anno-progress {
  display: flex;
  gap: 4px;
  padding: 10px 20px 0;
}
.anno-progress-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
}
.anno-progress-bar.top {
  background: rgba(255, 110, 90, 0.18);
}
.anno-progress-bar.active {
  background: rgba(246, 196, 83, 0.35);
}
.anno-progress-bar.active.top {
  background: rgba(255, 110, 90, 0.35);
}
.anno-progress-fill {
  position: absolute;
  inset: 0;
  background: #f6c453;
  transform-origin: left;
  animation: anno-fill var(--interval, 4500ms) linear forwards;
}
.anno-progress-fill.top {
  background: linear-gradient(90deg, #ff5b4e, #ff8a3c);
}
@keyframes anno-fill {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}

.anno-marquee {
  position: relative;
  min-height: 200px;
  padding: 22px 28px;
  overflow: hidden;
}
.anno-empty {
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  padding: 60px 0;
}
.anno-slide {
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: anno-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.anno-item-title {
  font-size: 18px;
  font-weight: 700;
  color: #f6c453;
  line-height: 1.4;
}
.anno-modal.is-top .anno-item-title {
  color: #ffba8e;
}
.anno-item-content {
  font-size: 14.5px;
  color: #e5e7eb;
  line-height: 1.75;
  white-space: pre-wrap;
  max-height: 220px;
  overflow-y: auto;
  word-break: break-word;
}
.anno-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #9ca3af;
}
.anno-meta-tag {
  display: inline-block;
  padding: 2px 8px;
  background: linear-gradient(90deg, rgba(255, 90, 60, 0.18), rgba(255, 138, 60, 0.18));
  border: 1px solid rgba(255, 110, 90, 0.4);
  color: #ff9d6e;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

/* 圆点导航（置顶项用红色） */
.anno-dots {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 0 0 12px;
}
.anno-dots .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  transition: all 0.2s;
}
.anno-dots .dot.on {
  background: #f6c453;
  width: 18px;
  border-radius: 999px;
}
.anno-dots .dot.on.top {
  background: linear-gradient(90deg, #ff5b4e, #ff8a3c);
}

.anno-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
}

/* 弹窗淡入 */
.anno-fade-enter-active, .anno-fade-leave-active {
  transition: opacity 0.25s;
}
.anno-fade-enter-from, .anno-fade-leave-to {
  opacity: 0;
}

/* 翻页动画：旧条目向下出、新条目从下向上入 */
.anno-slide-enter-active, .anno-slide-leave-active {
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s;
  position: absolute;
  left: 28px;
  right: 28px;
  top: 22px;
}
.anno-slide-enter-from {
  transform: translateY(110%);
  opacity: 0;
}
.anno-slide-leave-to {
  transform: translateY(-110%);
  opacity: 0;
}
@keyframes anno-rise {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>