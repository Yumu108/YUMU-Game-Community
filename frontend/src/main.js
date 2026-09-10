import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 9-10：Element Plus 改为**按需引入**（unplugin-vue-components + unplugin-auto-import，
// 配置见 vite.config.js）——不再 `app.use(ElementPlus)` 全量注册、不再引入
// `element-plus/dist/index.css` 全量样式；模板里的 <el-xxx>、代码里的
// ElMessage/ElMessageBox/ElNotification、v-loading 指令均由插件按需注入（含各自 CSS）。
// 图标按需注册（原先是 `import * as ElementPlusIconsVue` 全量注册 293 个图标，
// `import *` 无法被 tree-shake，全部打进主包，是首屏体积的大头之一）。
// 全项目实际只用到下面 13 个。新增图标时必须在此登记，否则模板里会出现空白图标。
import {
  Bell, CaretBottom, ChatDotRound, CircleCloseFilled, Close, EditPen, Flag,
  Grid, Search, Star, StarFilled, View, Warning
} from '@element-plus/icons-vue'
const icons = {
  Bell, CaretBottom, ChatDotRound, CircleCloseFilled, Close, EditPen, Flag,
  Grid, Search, Star, StarFilled, View, Warning
}

// 全局样式（设计令牌 + 基础重置）
import '@/styles/tokens.css'
import '@/styles/global.css'

import App from './App.vue'
import router from './router'
import { setupTokenWatch } from './utils/tokenWatch'

// 富文本（v-html 渲染的 @提及 / 站内链接）原本是原生 <a href="/...">，点击会触发浏览器整页硬刷新，
// 在 production 构建下需重新下载并解析 ~1.4MB 的 JS 包，造成 5~6s 的"跳转"卡顿。
// 这里统一拦截带 data-internal-link 标记的链接，改用 Vue Router 客户端路由跳转（SPA，瞬时）。
// 仅对普通左键点击拦截；中键 / Ctrl·Cmd·Shift·Alt 修饰键仍走浏览器默认（新标签打开）。
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.target.closest && e.target.closest('a[data-internal-link]')
  if (!a) return
  const to = a.getAttribute('data-internal-link')
  if (!to || !to.startsWith('/')) return
  e.preventDefault()
  router.push(to)
})

const app = createApp(App)

for (const [key, component] of Object.entries(icons)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.mount('#app')

// token 滑动续签的后台巡检（临期自动续签 + 跨标签页同步）
setupTokenWatch()
