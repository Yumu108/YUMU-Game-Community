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
/* ★ 9-10 收敛：置顶公告只在遮罩上留一层极淡的暖色氛围光，不再"打灯" */
.anno-modal.is-top {
  background:
    radial-gradient(circle at 50% 32%, rgba(206, 128, 92, 0.08), transparent 62%),
    rgba(0, 0, 0, 0.6);
}

/* ★ 9-10：卡片固定高度 + flex 纵向布局 —— 无论公告内容长短、导航条有无，外框尺寸恒定 */
.anno-card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(720px, 94vw);
  height: min(520px, 88vh);
  background: linear-gradient(160deg, #1f1b3d 0%, #14273a 100%);
  border: 1px solid rgba(230, 193, 121, 0.26);
  border-radius: 16px;
  box-shadow:
    0 18px 52px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  overflow: hidden;
  color: #f3f4f6;
}
/* ★ 9-10 收敛：置顶公告改为「深色底 + 低饱和暖调点缀」，只用左侧色条 + 极弱光晕表达重要性 */
.anno-modal.is-top .anno-card {
  background: linear-gradient(160deg, #2b1e2e 0%, #251c2c 52%, #1b2136 100%);
  border-color: rgba(206, 138, 104, 0.34);
  box-shadow:
    0 0 0 1px rgba(226, 156, 120, 0.08) inset,
    0 0 26px rgba(198, 116, 86, 0.12),
    0 18px 52px rgba(0, 0, 0, 0.56);
  animation: anno-pulse 5s ease-in-out infinite;
}
/* 左侧强调色条（替代整屏霓虹） */
.anno-modal.is-top .anno-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, #c97a52 0%, #a8553f 55%, rgba(168, 85, 63, 0.15) 100%);
  z-index: 3;
}
@keyframes anno-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 1px rgba(226, 156, 120, 0.08) inset,
      0 0 24px rgba(198, 116, 86, 0.10),
      0 18px 52px rgba(0, 0, 0, 0.56);
  }
  50% {
    box-shadow:
      0 0 0 1px rgba(226, 156, 120, 0.12) inset,
      0 0 32px rgba(198, 116, 86, 0.17),
      0 18px 52px rgba(0, 0, 0, 0.56);
  }
}

/* ★ 9-10 收敛：角标降饱和（深绛红→琥珀），去掉强投影 */
.anno-pin-badge {
  position: absolute;
  top: 14px;
  right: 56px; /* 避开右上角的关闭按钮 */
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: linear-gradient(135deg, #b85342, #c1854a);
  color: #ffeede;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  border: 1px solid rgba(255, 214, 180, 0.18);
  border-radius: 999px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.32);
  z-index: 4;
}
.anno-pin-badge .el-icon {
  font-size: 13px;
}

.anno-head {
  flex: none;
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(90deg, rgba(230, 193, 121, 0.09), transparent);
}
/* 置顶公告头部：同色系、更低对比 */
.anno-modal.is-top .anno-head {
  background: linear-gradient(90deg, rgba(201, 122, 82, 0.13), transparent);
  border-bottom-color: rgba(198, 138, 104, 0.2);
}

.anno-title {
  font-size: 16px;
  font-weight: 800;
  color: #e6c179;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.anno-title-icon {
  font-size: 17px;
}
.anno-modal.is-top .anno-title {
  color: #e0a878;
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
  flex: none;
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
  background: rgba(201, 122, 82, 0.16);
}
.anno-progress-bar.active {
  background: rgba(230, 193, 121, 0.3);
}
.anno-progress-bar.active.top {
  background: rgba(201, 122, 82, 0.3);
}
.anno-progress-fill {
  position: absolute;
  inset: 0;
  background: #e6c179;
  transform-origin: left;
  animation: anno-fill var(--interval, 4500ms) linear forwards;
}
.anno-progress-fill.top {
  background: linear-gradient(90deg, #b85342, #c1854a);
}
@keyframes anno-fill {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}

/* ★ 9-10：滚动区改为弹性填充（卡片固定高）——内容长短只影响区内滚动，不影响外框 */
.anno-marquee {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  padding: 22px 28px;
  overflow: hidden;
}
.anno-empty {
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  padding: 60px 0;
}
/* 🚨 必须绝对定位贴合滚动区：只写 height:100% 时弹性收缩不生效，
   长公告会把底部「发布人 · 时间」顶出 overflow:hidden 之外（实测被裁 22~27px）。
   top/bottom 同时给定 → 高度确定 → 正文 flex:1 + min-height:0 才能正确内滚。 */
.anno-slide {
  position: absolute;
  top: 22px;
  right: 28px;
  bottom: 22px;
  left: 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: anno-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.anno-item-title {
  flex: none;
  font-size: 18px;
  font-weight: 700;
  color: #e6c179;
  line-height: 1.4;
}
.anno-modal.is-top .anno-item-title {
  color: #e9bd95;
}
.anno-item-content {
  flex: 1 1 auto;
  min-height: 0;
  font-size: 14.5px;
  color: #e5e7eb;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 6px;
  word-break: break-word;
}
/* 区内细滚动条（长文才出现） */
.anno-item-content::-webkit-scrollbar {
  width: 6px;
}
.anno-item-content::-webkit-scrollbar-track {
  background: transparent;
}
.anno-item-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 999px;
}
.anno-item-content::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.24);
}
.anno-item-meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #9ca3af;
}
.anno-meta-tag {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(201, 122, 82, 0.14);
  border: 1px solid rgba(206, 138, 104, 0.3);
  color: #d9a17f;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

/* 圆点导航（置顶项用暖色） */
.anno-dots {
  flex: none;
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
  background: #e6c179;
  width: 18px;
  border-radius: 999px;
}
.anno-dots .dot.on.top {
  background: linear-gradient(90deg, #b85342, #c1854a);
}

.anno-foot {
  flex: none;
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
/* ★ 9-10：`.anno-slide` 已是绝对定位（贴合滚动区），此处只需过渡，四边不再重复声明 */
.anno-slide-enter-active, .anno-slide-leave-active {
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s;
  z-index: 1;
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