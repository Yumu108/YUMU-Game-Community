<template>
  <div class="layout">
    <TopBar />
    <div class="body" :class="{ 'no-rail': hideRail }">
      <SideNav />
      <main ref="contentRef" class="content">
        <slot />
      </main>
      <div v-if="!hideRail" ref="railRef" class="rail-wrap">
        <RightRail />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import TopBar from './TopBar.vue'
import SideNav from './SideNav.vue'
import RightRail from './RightRail.vue'

defineProps({
  // 编辑器、登录等专用页面用：避免与页面内的两栏/弹窗冲突
  hideRail: { type: Boolean, default: false }
})

// 9-08：左右独立滚动 + 边缘渐变阴影。
//   - 给 .content 与 .rail-wrap 各自加 overflow-y: auto（仅宽屏）
//   - JS 监听 scroll + ResizeObserver，根据「到顶/到底」切换 .has-top / .has-bottom 类
//   - 阴影用 ::before/::after 伪元素 + position: sticky 钉在视口边缘（不影响内容布局）
const contentRef = ref(null)
const railRef = ref(null)
const cleanups = []

function bindShadow(el) {
  if (!el) return
  const update = () => {
    const hasTop = el.scrollTop > 4
    const hasBottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4
    el.classList.toggle('has-top', hasTop)
    el.classList.toggle('has-bottom', hasBottom)
  }
  // scroll：用户滚动时实时切换
  el.addEventListener('scroll', update, { passive: true })
  // RO：窗口/自身尺寸变化时刷新（如 resize、窄屏折叠）
  const ro = new ResizeObserver(update)
  ro.observe(el)
  // ★ 关键：overflow 容器有界后，内部内容变高只会让 scrollHeight 涨，
  //   ResizeObserver 不会触发（它只看元素自身盒子）。必须用 MutationObserver 兜底，
  //   否则右栏异步加载内容后「底部阴影」迟迟不出现。rAF 防抖合并同一帧多次变更。
  let raf = 0
  const mo = new MutationObserver(() => {
    if (raf) return
    raf = requestAnimationFrame(() => { raf = 0; update() })
  })
  mo.observe(el, { childList: true, subtree: true, characterData: true })
  const onResize = () => update()
  window.addEventListener('resize', onResize)
  cleanups.push(() => {
    el.removeEventListener('scroll', update)
    ro.disconnect()
    mo.disconnect()
    if (raf) cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
  })
  update()
}

onMounted(async () => {
  await nextTick()
  bindShadow(contentRef.value)
  bindShadow(railRef.value)
})
onBeforeUnmount(() => cleanups.forEach((fn) => fn()))
</script>

<style scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr) 300px;
  gap: 18px;
  max-width: 1320px;
  width: 100%;
  margin: 0 auto;
  padding: 18px 20px 40px;
  align-items: start;
}
/* 编辑器等页面：去掉右栏，content 占满剩余空间 */
.body.no-rail {
  grid-template-columns: 232px minmax(0, 1fr);
  max-width: 1280px;
}
.content,
.rail-wrap {
  min-width: 0;
  min-height: 0;
}
.side {
  align-self: start; /* 短导航不撑高，避免出现高耸的深色左列 */
}

/* ========== 9-08 宽屏：左右独立滚动 ========== */
@media (min-width: 1081px) {
  .layout {
    height: 100vh; /* 整页不再有滚动条 */
  }
  .body {
    overflow: hidden; /* 把滚动权交给下面的两栏 */
    /* ★ 关键：行高必须约束在 body 高度内（minmax(0,1fr)），
         否则 grid 行按内容撑高 → 两栏盒子跟内容一样高 → overflow-y:auto 永不触发 → 整页死滚 */
    grid-template-rows: minmax(0, 1fr);
    align-items: stretch; /* 覆盖基线 .body 的 start：让两栏真正撑满有界的行 */
  }
  .content,
  .rail-wrap {
    overflow-y: auto;
    position: relative;
  }

  /* 滚动阴影：sticky 伪元素钉在视口边缘，不占内容空间 */
  .content::before,
  .content::after,
  .rail-wrap::before,
  .rail-wrap::after {
    content: '';
    position: sticky;
    display: block;
    height: 14px;
    pointer-events: none;
    z-index: 5;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .content::before,
  .rail-wrap::before {
    top: 0;
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.35), transparent);
  }
  .content::after,
  .rail-wrap::after {
    bottom: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.35), transparent);
  }
  .content.has-top::before,
  .rail-wrap.has-top::before,
  .content.has-bottom::after,
  .rail-wrap.has-bottom::after {
    opacity: 1;
  }
}

/* ========== 窄屏：恢复单列 + 整页滚动（保留历史行为） ========== */
@media (max-width: 1080px) {
  .body {
    grid-template-columns: 200px minmax(0, 1fr);
  }
  .rail-wrap {
    display: none;
  }
}
@media (max-width: 760px) {
  .body,
  .body.no-rail {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: none;
  }
}
</style>
