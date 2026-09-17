import { createSSRApp } from 'vue'
import App from './App.vue'

// uni-app 要求导出 createApp 工厂（SSR 形态），不要直接 createApp().mount()
export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
