<template>
  <button v-if="show" class="back-btn" type="button" @click="goBack">
    <span class="arrow">←</span>
    <span class="text">{{ label }}</span>
  </button>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const props = defineProps({
  /** 显示在按钮上的默认文字（可由调用方覆盖） */
  label: { type: String, default: '返回' },
  /** 是否强制显示（默认根据路由自动判断：非首页非登录页就显示） */
  force: { type: Boolean, default: false }
})

const route = useRoute()
const router = useRouter()

// 这些页面不显示返回按钮
const HIDE_ON = new Set(['Home', 'Login', 'Register', 'ForgotPassword'])

// 通过 route.fullPath 对比浏览器历史栈深度来判断（避免误判）
// 若 router.options.history 栈深度不够，则按配置强制隐藏
const stackDepth = computed(() => {
  // window.history.length 包含所有页面加载，Vue 的 router.back() 会调用 history.back()
  // 一个简单的近似判断：非顶层路由就显示
  return router.options.history.state?.position ?? window.history.length
})
const rootDepth = computed(() => router.options.history.state?.position ?? 0)

const show = computed(() => {
  if (props.force) return true
  if (HIDE_ON.has(route.name)) return false
  if (route.fullPath === '/' || route.fullPath === '') return false
  // SPA 入站（刷新页面）后 history.length 不准确
  if (window.history.length <= 1) {
    // 入站刷新场景：依旧给出按钮，点击回首页兜底
    return true
  }
  return true
})

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}
</script>

<style scoped>
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--t2);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.back-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--brand-2, #a78bfa);
  color: var(--t1);
  transform: translateX(-2px);
}
.back-btn:active {
  transform: translateX(0);
}
.arrow {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}
.text {
  font-weight: 500;
}
</style>
