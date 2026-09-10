import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import path from 'path'

// Element Plus 按需引入（9-10）：
//   原先 `app.use(ElementPlus)` + `import 'element-plus/dist/index.css'` 是**全量**引入，
//   Element 全家桶（30+ 组件 + 全部样式）都进主包，是主包 1156KB 的最大头。
//   改为：
//     · Components  —— 模板里的 <el-xxx> 按需自动 import（含对应 CSS）
//     · AutoImport  —— 代码里的 ElMessage / ElMessageBox / ElNotification 等 API 按需注入（含其 CSS）
//     · directives  —— v-loading 等指令也按需注册（TopBar / Admin / UserProfile 用到）
//   注意：入口 CSS 与懒加载 chunk CSS 存在加载先后，凡在 global.css 里覆盖 Element
//   样式的规则都要自行提升特异性（参见 global.css 的 .el-skeleton 注释）。
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      dts: false // 纯 JS 项目，不生成 auto-imports.d.ts
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      directives: true, // 解析 v-loading / v-infinite-scroll 等指令
      dts: false // 不生成 components.d.ts
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true
      }
    }
  },
  // `npm run preview` 用生产构建产物起本地静态服务（4173），同样代理 /api。
  // 用途：① 校验「按需引入」后的真实产物（dev 的依赖预构建与产物无关）；
  //       ② dev server 被 Vite 依赖预构建的批量删除守卫干扰时的替代验证通道。
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
