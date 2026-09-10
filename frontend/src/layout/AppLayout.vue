<template>
  <div class="layout">
    <TopBar @toggle-nav="navOpen = true" />
    <div class="body" :class="{ 'no-rail': hideRail }">
      <SideNav />
      <main ref="contentRef" class="content">
        <slot />
      </main>
      <div v-if="!hideRail" ref="railRef" class="rail-wrap">
        <RightRail />
      </div>
    </div>

    <!-- ===== 移动端导航抽屉（9-10） =====
         ≤760px 时左侧 SideNav 被隐藏（见文件末尾媒体查询），改由顶栏汉堡打开此抽屉。
         抽屉内**直接复用 <SideNav />**：导航项/权限判断/退出确认只维护一份，
         两边永不脱节（若复制一份导航 HTML，以后加板块就要改两处）。 -->
    <transition name="nav-mask">
      <div v-if="navOpen" class="nav-mask" @click="navOpen = false" />
    </transition>
    <transition name="nav-slide">
      <aside v-if="navOpen" class="nav-panel" role="dialog" aria-modal="true" aria-label="站点导航">
        <div class="nav-panel-head">
          <span class="np-title">导航</span>
          <button class="np-close" type="button" aria-label="关闭导航" @click="navOpen = false">
            <el-icon><Close /></el-icon>
          </button>
        </div>
        <!-- ≤480px 顶栏搜索框被隐藏，这里补一个可用宽度的搜索入口 -->
        <div class="nav-panel-search">
          <input
            v-model="navKw"
            class="nps-input"
            placeholder="搜索游戏、攻略、玩家…"
            @keyup.enter="onNavSearch"
          />
        </div>
        <div class="nav-panel-body" @click="onPanelClick">
          <SideNav />
        </div>
      </aside>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Close } from '@element-plus/icons-vue'
import TopBar from './TopBar.vue'
import SideNav from './SideNav.vue'
import RightRail from './RightRail.vue'

defineProps({
  // 编辑器、登录等专用页面用：避免与页面内的两栏/弹窗冲突
  hideRail: { type: Boolean, default: false }
})

/* ===== 移动端导航抽屉状态（9-10） ===== */
const navOpen = ref(false)
const navKw = ref('')
const route = useRoute()
const router = useRouter()

function onNavSearch() {
  const k = navKw.value.trim()
  if (!k) return
  navOpen.value = false
  navKw.value = ''
  router.push(`/search?keyword=${encodeURIComponent(k)}`)
}

// 打开时锁背景滚动，避免抽屉后面整页跟着滚
watch(navOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})
// 路由变化即收起：点抽屉里的导航项跳转后自动关闭，不用手动点遮罩
watch(() => route.fullPath, () => { navOpen.value = false })

// 点导航项即收起（事件委托，不侵入 SideNav）。
// ⚠️ 必须有这条：路由监听只认 fullPath 变化，「当前已在首页时点『综合首页』」
//    属于同路由 push → fullPath 不变 → 监听不触发 → 抽屉赖着不关，用户会以为点不动。
// 另外 .gb-clear（取消游戏筛选）不算导航，点它不该关抽屉。
function onPanelClick(e) {
  if (e.target.closest('.gb-clear')) return
  const hit = e.target.closest('a.nav-item, button.nav-item, .game-banner')
  if (hit) navOpen.value = false
}
// 旋屏/拉宽到桌面宽度时强制收起。
// ⚠️ 必须显式处理：抽屉面板在 >760px 被 CSS display:none 藏掉，
//    但 navOpen 仍是 true → body 的 overflow:hidden 不清除 → 整页再也滚不动。
function onWinResize() {
  if (navOpen.value && window.innerWidth > 760) navOpen.value = false
}
function onWinKeydown(e) {
  if (e.key === 'Escape' && navOpen.value) navOpen.value = false
}

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
  window.addEventListener('resize', onWinResize)
  window.addEventListener('keydown', onWinKeydown)
  cleanups.push(() => {
    window.removeEventListener('resize', onWinResize)
    window.removeEventListener('keydown', onWinKeydown)
    // 卸载兜底：万一带着抽屉离开页面，别把 body 锁死
    document.body.style.overflow = ''
  })
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
/* ⚠️ 用 `.body > .side` 而不是 `.side`：抽屉里也复用了 <SideNav />（根元素同样带 .side），
   若不限定直接子级，下面 ≤760px 的 display:none 会把抽屉里的导航也一起藏掉。 */
.body > .side {
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
  /* 左栏收起，改用顶栏汉堡 + 抽屉（.body > .side 限定只命中栅格里的那个） */
  .body > .side {
    display: none;
  }
}

/* ============================================================
   移动端导航抽屉（9-10）
   触发：TopBar 汉堡 → @toggle-nav → navOpen=true
   组成：遮罩 .nav-mask + 面板 .nav-panel（头部 + 搜索 + 复用 SideNav）
   交互：点遮罩/关闭键/ESC/路由变化/拉宽到桌面 均自动收起；打开时锁 body 滚动
   ============================================================ */
.nav-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.nav-panel {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 41;
  width: min(82vw, 300px);
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
  border-right: 1px solid var(--border);
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
  padding: 12px 12px 0;
  overflow: hidden;
}
.nav-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 10px;
  flex: none;
}
.np-title {
  font-weight: 800;
  font-size: 15px;
  color: var(--t1);
}
.np-close {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg-3);
  color: var(--t2);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.np-close:hover {
  color: var(--brand);
  border-color: var(--brand);
}
/* 抽屉内搜索入口：仅 ≤480px 显示（与顶栏 .search 的隐藏断点严格对齐，避免重复出现） */
.nav-panel-search {
  display: none;
  flex: none;
  padding: 0 2px 10px;
}
.nps-input {
  width: 100%;
  height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--t1);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.nps-input:focus {
  border-color: var(--brand);
}
.nps-input::placeholder {
  color: var(--t3);
}
.nav-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 20px;
}
/* 抽屉里的 SideNav 去掉卡片外观，融进面板（:deep 穿透子组件 scoped） */
.nav-panel-body :deep(.side) {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0 2px;
}

/* 过渡：遮罩淡入淡出 + 面板左滑进出 */
.nav-mask-enter-active,
.nav-mask-leave-active {
  transition: opacity 0.22s ease;
}
.nav-mask-enter-from,
.nav-mask-leave-to {
  opacity: 0;
}
.nav-slide-enter-active,
.nav-slide-leave-active {
  transition: transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.nav-slide-enter-from,
.nav-slide-leave-to {
  transform: translateX(-100%);
}

/* 桌面端兜底：任何情况下都不渲染抽屉（防「拉宽后残留 + body 被锁死」） */
@media (min-width: 761px) {
  .nav-mask,
  .nav-panel {
    display: none;
  }
}
@media (max-width: 480px) {
  .nav-panel-search {
    display: block;
  }
}
</style>
