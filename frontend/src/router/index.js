import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/store'
// 首屏页面静态引入（避免首屏还要多等一个 chunk 请求）
import Home from '@/views/Home.vue'

/**
 * 路由级懒加载：除首屏 Home 外，其余页面全部动态 import。
 *
 * 改造前 19 个页面全部静态 import → 打进单个 1.4MB 的 index-*.js，首屏要下载完整包。
 * 改造后每个页面独立 chunk，访问 /post/:id 时才下载 PostDetail 的 chunk；
 * 配合浏览器缓存，二次访问与重复跳转几乎零下载成本（与 SWR 快照缓存叠加更顺滑）。
 */
const Board = () => import('@/views/Board.vue')
const PostDetail = () => import('@/views/PostDetail.vue')
const Editor = () => import('@/views/Editor.vue')
const Login = () => import('@/views/Login.vue')
const My = () => import('@/views/My.vue')
const Search = () => import('@/views/Search.vue')
const UserProfile = () => import('@/views/UserProfile.vue')
const Announcements = () => import('@/views/Announcements.vue')
const Messages = () => import('@/views/Messages.vue')
const Notifications = () => import('@/views/Notifications.vue')
const TagPosts = () => import('@/views/TagPosts.vue')
const Admin = () => import('@/views/Admin.vue')
const Games = () => import('@/views/Games.vue')
const GameDetail = () => import('@/views/GameDetail.vue')
const Subscribe = () => import('@/views/Subscribe.vue')
const MyReports = () => import('@/views/MyReports.vue')
const Legal = () => import('@/views/Legal.vue')

const routes = [
  { path: '/', name: 'Home', component: Home },
  { path: '/board/:id', name: 'Board', component: Board },
  { path: '/post/:id', name: 'PostDetail', component: PostDetail },
  { path: '/search', name: 'Search', component: Search },
  { path: '/user/:id', name: 'UserProfile', component: UserProfile },
  { path: '/tag/:id', name: 'TagPosts', component: TagPosts },
  { path: '/announcements', name: 'Announcements', component: Announcements },
  // 游戏库（公开）
  { path: '/games', name: 'Games', component: Games },
  { path: '/game/:id', name: 'GameDetail', component: GameDetail },
  // 协议页（公开，注册页需勾选跳转至此）。
  // 注意：Legal.vue 用 route.path 判断显示哪份文档，不接收 props —— 这里不要传 props，
  // 否则会作为未声明 attribute 落到根元素上。
  { path: '/agreement', name: 'Agreement', component: Legal },
  { path: '/privacy', name: 'Privacy', component: Legal },
  // 以下页面需登录
  { path: '/editor', name: 'Editor', component: Editor, meta: { requiresAuth: true } },
  { path: '/my', name: 'My', component: My, meta: { requiresAuth: true } },
  { path: '/subscribe', name: 'Subscribe', component: Subscribe, meta: { requiresAuth: true } },
  { path: '/messages', name: 'Messages', component: Messages, meta: { requiresAuth: true } },
  { path: '/messages/:userId', name: 'MessageChat', component: Messages, meta: { requiresAuth: true } },
  { path: '/notifications', name: 'Notifications', component: Notifications, meta: { requiresAuth: true } },
  // C2 举报闭环：我的举报状态页
  { path: '/my-reports', name: 'MyReports', component: MyReports, meta: { requiresAuth: true } },
  { path: '/admin', name: 'Admin', component: Admin, meta: { requiresAuth: true } },
  { path: '/login', name: 'Login', component: Login }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  if (to.meta?.requiresAuth && !userStore.isLoggedIn) {
    next('/login')
  } else {
    next()
  }
})

export default router
