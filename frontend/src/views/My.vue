<template>
  <AppLayout>
    <div class="my">
      <!-- 用户卡片 -->
      <div class="ucard">
        <AvatarPreview
          :size="56"
          :src="userStore.userInfo?.avatar"
          :name="userStore.userInfo?.name || '游客'"
          class="u-ava"
        />
        <div class="u-info">
          <div class="u-name">
            <span>{{ userStore.userInfo?.name || '游客' }}</span>
            <span class="u-account num" title="账号用户名（登录名）">账号id:{{ userStore.userInfo?.username || '—' }}</span>
            <el-tag v-if="userStore.userInfo?.badge === 'ADMIN'" type="danger" size="small" effect="dark" class="u-role">🛡️ 管理员</el-tag>
            <el-tag v-else-if="userStore.userInfo?.badge === 'MODERATOR'" type="warning" size="small" effect="dark" class="u-role" :title="myModBadgeTip">⭐ {{ myModBadgeText }}</el-tag>
            <el-tag v-else-if="userStore.userInfo?.badge === 'SUB_MODERATOR'" type="primary" size="small" effect="dark" class="u-role">🔹 子版主</el-tag>
          </div>
          <div v-if="userStore.userInfo?.moderatorBoardNames?.length" class="u-boards">
            <span class="b-label">负责板块：</span>
            <el-tag
              v-for="(n, i) in userStore.userInfo.moderatorBoardNames"
              :key="userStore.userInfo.moderatorBoardIds[i] || n"
              size="small"
              type="info"
              effect="plain"
              class="b-tag"
            >{{ n }}</el-tag>
          </div>
          <div class="u-sub">{{ userStore.userInfo?.bio || 'YUMU 游戏社区成员' }}</div>
        </div>
        <div class="u-stats">
          <div class="stat"><b class="num">{{ myPoints }}</b><small>积分</small></div>
          <div class="stat"><b class="num">{{ visiblePostCount }}</b><small>帖子</small></div>
          <div class="stat"><b class="num">{{ favCount }}</b><small>收藏</small></div>
          <div class="stat"><b class="num">{{ likeReceivedCount }}</b><small>获赞</small></div>
          <div class="stat"><b class="num">{{ followingCount }}</b><small>关注</small></div>
          <div class="stat"><b class="num">{{ followersCount }}</b><small>粉丝</small></div>
        </div>
      </div>

      <!-- tab -->
      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- 我的主页 -->
      <template v-if="tab === 'home'">
        <div class="profile-grid">
          <section class="pcard">
            <h3 class="pc-title">🎮 游戏爱好</h3>
            <div v-if="favGames.length" class="chip-list game-chip-list">
              <router-link
                v-for="g in favGames"
                :key="g.id"
                :to="`/game/${g.id}`"
                class="chip game-chip"
                :title="`${g.name}${g.platform ? ' · ' + g.platform : ''}`"
              >
                <img v-if="g.cover" :src="g.cover" class="gc-cover" alt="" />
                <span v-else class="gc-cover gc-cover-fallback">{{ g.name?.[0] || '🎮' }}</span>
                <span class="gc-name">{{ g.name }}</span>
              </router-link>
            </div>
            <p v-else class="muted">还没有选游戏爱好，去「账号设置」选几个吧～</p>
          </section>

          <section class="pcard">
            <h3 class="pc-title">📌 常看板块</h3>
            <div v-if="favBoards.length" class="chip-list">
              <router-link
                v-for="b in favBoards"
                :key="b.id"
                :to="`/board/${b.id}`"
                class="chip board"
              >{{ b.icon }} {{ b.name }}</router-link>
            </div>
            <p v-else class="muted">还没有关注板块，去「账号设置」选几个吧～</p>
          </section>

          <section class="pcard">
            <h3 class="pc-title">💎 积分 & 签到</h3>
            <div class="sign-row">
              <div class="sign-info">
                <div class="sign-total num">{{ myPoints }} 积分</div>
                <div class="sign-sub">连续签到 {{ myContinuous }} 天{{ mySigned ? ' · 今日已签 ✓' : '' }}</div>
              </div>
              <el-button
                :type="mySigned ? 'info' : 'warning'"
                :loading="mySignLoading"
                @click="doMySignIn"
              >{{ mySigned ? '今日已签到' : '签到 +10' }}</el-button>
            </div>
            <!-- 积分规则 / 最近记录：两个并排折叠入口，展开后内容在下方显示 -->
            <div class="points-toggles">
              <div
                class="points-toggle"
                :class="{ active: showPointsRules }"
                @click="showPointsRules = !showPointsRules"
              >
                <span>积分规则</span>
                <el-icon class="pt-caret" :class="{ open: showPointsRules }"><CaretBottom /></el-icon>
              </div>
              <div
                class="points-toggle"
                :class="{ active: showPointsLogs }"
                @click="showPointsLogs = !showPointsLogs"
              >
                <span>最近积分记录</span>
                <el-icon class="pt-caret" :class="{ open: showPointsLogs }"><CaretBottom /></el-icon>
              </div>
            </div>
            <div v-show="showPointsRules" class="plist-wrap">
              <div class="plist">
                <div v-for="r in pointsRules" :key="r.type" class="prow">
                  <span class="ptype">{{ r.typeText }}</span>
                  <span class="pdesc">{{ r.desc }}</span>
                  <span class="pdelta num up">+{{ r.delta }}</span>
                </div>
              </div>
            </div>
            <div v-show="showPointsLogs" class="plist-wrap">
              <div v-if="pointsLogs.length" class="plist">
                <div v-for="l in pointsLogs" :key="l.id" class="prow">
                  <span class="ptype">{{ l.typeText }}</span>
                  <span class="pdesc">{{ l.description || '' }}</span>
                  <span class="pdelta num" :class="l.delta >= 0 ? 'up' : 'down'">{{ l.delta >= 0 ? '+' : '' }}{{ l.delta }}</span>
                </div>
              </div>
              <p v-else class="muted">暂无积分记录</p>
            </div>
          </section>

          <section class="pcard span2">
            <h3 class="pc-title">📝 最近发帖</h3>
            <PostCard v-for="p in myPosts.slice(0, 5)" :key="p.id" :post="p" />
            <el-empty v-if="!myPosts.length" :image-size="60" description="还没有发帖" />
          </section>
        </div>
        <el-button type="primary" @click="goEditor">去发一帖</el-button>
      </template>

      <!-- 我的帖子 -->
      <template v-else-if="tab === 'posts'">
        <div v-for="p in myPosts" :key="p.id" class="my-post-item" @click="goPost(p.id)">
          <div class="m-p-head">
            <span class="m-p-title">{{ p.title }}</span>
            <el-tag v-if="p.status === 1 && p.rejectReason" type="danger" size="small" :title="p.rejectReason">已驳回</el-tag>
            <el-tag v-else-if="p.status === 1" type="warning" size="small">已隐藏</el-tag>
            <el-tag v-else-if="p.status === 2 && p.resubmitAt" type="primary" size="small" title="被驳回后已重新提交，等待再次审核">待重审</el-tag>
            <el-tag v-else-if="p.status === 2" type="info" size="small">待审核</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </div>
          <div class="m-p-meta">
            <span>👍 {{ p.likeCount }}</span>
            <span>💬 {{ p.replyCount }}</span>
            <span>👁 {{ p.viewCount }}</span>
            <span class="m-p-time num">{{ p.resubmitAt ? `${p.resubmitAt} · 重新提交` : p.createdAt }}</span>
          </div>
          <!-- @click.stop 阻止冒泡到 my-post-item 的整行跳转，避免点操作按钮时误跳转 -->
          <div class="m-p-actions" @click.stop>
            <!-- 被驳回的帖子不能直接恢复可见，需重新编辑提交审核 -->
            <el-button v-if="p.status === 1 && p.rejectReason" size="small" type="primary" plain @click="goEditPost(p)">重新编辑并提审</el-button>
            <el-button v-else-if="p.status === 1" size="small" @click="doRestore(p)">恢复</el-button>
            <!-- 待审帖无需隐藏（本来就不可见），编辑保存后仍保持待审 -->
            <el-button v-else-if="p.status === 2" size="small" plain @click="goEditPost(p)">编辑</el-button>
            <el-button v-else size="small" @click="doHide(p)">隐藏</el-button>
            <el-button size="small" type="danger" plain @click="doDelete(p)">删除</el-button>
          </div>
        </div>
        <el-empty v-if="!myPosts.length" description="你还没有发布过帖子" :image-size="80" />
      </template>

      <!-- 我的收藏 -->
      <template v-else-if="tab === 'favorites'">
        <PostCard v-for="p in favList" :key="p.id" :post="p" />
        <el-empty v-if="!favList.length" description="还没有收藏任何帖子" :image-size="80" />
      </template>

      <!-- 我的关注 -->
      <template v-else-if="tab === 'following'">
        <div class="follow-list">
          <div v-for="u in followingList" :key="u.id" class="follow-item">
            <div class="f-user" @click="goUser(u.id)">
              <el-avatar :size="36" :src="u.avatar" class="f-ava">{{ u.name?.[0] || '游' }}</el-avatar>
              <div class="f-info">
                <span class="f-name">{{ u.name }}</span>
                <span class="f-bio">{{ u.bio }}</span>
              </div>
            </div>
            <el-button size="small" type="danger" plain @click="unfollow(u)">取消关注</el-button>
          </div>
        </div>
        <el-empty v-if="!followingList.length" description="还没有关注任何人" :image-size="80" />
      </template>

      <!-- 我的粉丝 -->
      <template v-else-if="tab === 'followers'">
        <div class="follow-list">
          <div v-for="u in followersList" :key="u.id" class="follow-item">
            <div class="f-user" @click="goUser(u.id)">
              <el-avatar :size="36" :src="u.avatar" class="f-ava">{{ u.name?.[0] || '游' }}</el-avatar>
              <div class="f-info">
                <span class="f-name">{{ u.name }}</span>
                <span class="f-bio">{{ u.bio }}</span>
              </div>
            </div>
            <el-button
              size="small"
              :type="u.isFollowing ? 'danger' : 'primary'"
              plain
              @click="followBack(u)"
            >
              {{ u.isFollowing ? '取关' : '回关' }}
            </el-button>
          </div>
        </div>
        <el-empty v-if="!followersList.length" description="还没有粉丝" :image-size="80" />
      </template>

      <!-- 账号设置 -->
      <template v-else-if="tab === 'settings'">
        <div class="settings">
          <el-form :model="profileForm" label-width="84px" class="set-form">
            <h3 class="pc-title">👤 基本资料</h3>
            <el-form-item label="昵称">
              <el-input v-model="profileForm.nickname" maxlength="50" placeholder="你的昵称" />
            </el-form-item>
            <el-form-item label="头像">
              <div class="avatar-row">
                <el-avatar :size="48" :src="profileForm.avatar" class="ava">{{ initial }}</el-avatar>
                <el-upload
                  :show-file-list="false"
                  :auto-upload="true"
                  :http-request="uploadAvatar"
                  accept="image/*"
                >
                  <el-button size="small">上传头像</el-button>
                </el-upload>
                <el-input v-model="profileForm.avatar" placeholder="或粘贴头像 URL" class="ava-url" />
              </div>
            </el-form-item>
            <el-form-item label="个性签名">
              <el-input
                v-model="profileForm.bio"
                type="textarea"
                :rows="2"
                maxlength="200"
                show-word-limit
                placeholder="一句话介绍自己"
              />
            </el-form-item>
            <el-form-item label="游戏爱好">
              <el-select
                v-model="profileForm.favGameIdsArr"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                clearable
                placeholder="从游戏库多选（可搜索）"
                class="game-pick"
                style="width: 100%"
              >
                <el-option
                  v-for="g in allGames"
                  :key="g.id"
                  :value="g.id"
                  :label="g.name"
                >
                  <div class="gp-row">
                    <img v-if="g.cover" :src="g.cover" class="gp-cover" alt="" />
                    <span v-else class="gp-cover gp-cover-fallback">{{ g.name?.[0] || '🎮' }}</span>
                    <span class="gp-name">{{ g.name }}</span>
                    <span v-if="g.platform || g.genre" class="gp-meta">{{ [g.platform, g.genre].filter(Boolean).join(' · ') }}</span>
                  </div>
                </el-option>
              </el-select>
            </el-form-item>
            <el-form-item label="常看板块">
              <el-checkbox-group v-model="profileForm.favBoardIdsArr" class="board-pick">
                <el-checkbox v-for="b in allBoards" :key="b.id" :value="b.id">
                  {{ b.icon }} {{ b.name }}
                </el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-button type="primary" :loading="saving" @click="saveProfile">保存资料</el-button>
          </el-form>

          <el-form :model="accountForm" label-width="84px" class="set-form">
            <h3 class="pc-title">🔑 登录账号</h3>
            <el-form-item label="当前账号">
              <span class="acc-now">@{{ userStore.userInfo?.username }}</span>
            </el-form-item>
            <template v-if="userStore.userInfo?.canChangeUsername">
              <el-form-item label="新账号">
                <div class="acc-change">
                  <el-input
                    v-model="accountForm.newUsername"
                    maxlength="20"
                    placeholder="3-20 位，仅字母/数字/下划线"
                  />
                  <el-button type="primary" :loading="savingUser" @click="saveUsername">修改账号</el-button>
                </div>
              </el-form-item>
              <el-form-item label="">
                <span class="acc-tip">账号每年仅可修改一次，修改后下次登录请使用新账号。</span>
              </el-form-item>
            </template>
            <el-alert
              v-else
              type="info"
              :closable="false"
              show-icon
              class="acc-lock"
              :title="`账号每年可修改一次，下次可修改时间：${nextChangeText}`"
            />
          </el-form>

          <el-form :model="pwdForm" label-width="84px" class="set-form">
            <h3 class="pc-title">🔒 修改密码</h3>
            <el-form-item label="原密码">
              <el-input v-model="pwdForm.oldPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="6-100 位" />
            </el-form-item>
            <el-button type="warning" :loading="savingPwd" @click="savePassword">更新密码</el-button>
          </el-form>
        </div>
      </template>
    </div>
  </AppLayout>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CaretBottom } from '@element-plus/icons-vue'
import AppLayout from '@/layout/AppLayout.vue'
import PostCard from '@/components/PostCard.vue'
import AvatarPreview from '@/components/AvatarPreview.vue'
import { useUserStore } from '@/store'
import {
  getMyPosts,
  getFavorites,
  getFollowing,
  getFollowers,
  getFollowCounts,
  getBoards,
  toggleFollow,
  updateProfile,
  updatePassword,
  updateUsername,
  uploadImage,
  getPointsStatus,
  signIn,
  getPointsLogs,
  getMe,
  deletePost,
  hidePost,
  restorePost,
  getGames
} from '@/api/community'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const tab = ref(route.query.tab || 'home')
const myPosts = ref([])
const favList = ref([])
const followingList = ref([])
const followersList = ref([])
const followingCount = ref(0)
const followersCount = ref(0)
const allBoards = ref([])
// 游戏库全量（用于"游戏爱好"多选；1.2 起替代 hobbies 自由文本）
const allGames = ref([])
// 顶部"帖子"数只统计可见帖（隐藏/待审核不计入，删除后自动减少）
const visiblePostCount = computed(() =>
  myPosts.value.filter((p) => p.status == null || p.status === 0).length
)
// 积分 / 签到
// 积分 / 签到：积分与「今日是否已签」来自 user store（与 TopBar 共享），避免本地两份数据互不同步
const myPoints = computed(() => userStore.points)
const mySigned = computed(() => userStore.signedToday)
const myContinuous = ref(0)
const mySignLoading = ref(false)
const pointsLogs = ref([])
// 积分规则 / 最近记录：两个折叠面板，默认收起避免首屏铺满
const showPointsRules = ref(false)
const showPointsLogs = ref(false)
// 积分规则（与后端 PointsService.addPoints 保持一致）
const pointsRules = [
  { type: 1, typeText: '每日签到', desc: '连续签到天数越多奖励越高', delta: '10~50' },
  { type: 2, typeText: '发布帖子', desc: '每发布一篇公开帖子', delta: 5 },
  { type: 3, typeText: '发表回复', desc: '每发表一条公开回复', delta: 2 },
  { type: 4, typeText: '获得点赞', desc: '帖子每获得一个赞', delta: 1 },
  { type: 5, typeText: '精华奖励', desc: '帖子被管理员/版主加精', delta: 20 }
]
// 获赞总数（独立响应式：每次进入页面直接拉 API，避免依赖 userStore 缓存）
const likeReceivedCount = ref(0)

const initial = computed(() => userStore.userInfo?.name?.[0] || '游')
// 1.2 起：版主徽章拼上负责游戏名 + tooltip 列出全部
const myModBadgeText = computed(() => {
  const names = userStore.userInfo?.moderatorGameNames || []
  if (names.length === 0) return '版主'
  const extra = names.length - 1
  return `版主 · ${names[0]}${extra > 0 ? ` (+${extra})` : ''}`
})
const myModBadgeTip = computed(() => {
  const names = userStore.userInfo?.moderatorGameNames || []
  if (names.length === 0) return '当前账号尚未分配负责游戏'
  if (names.length === 1) return `负责游戏：${names[0]}`
  return `负责游戏（${names.length} 个）：${names.join('、')}`
})

// 账号下次可修改时间（后端返回 ISO 字符串，截取到日期）
const nextChangeText = computed(() => {
  const t = userStore.userInfo?.nextUsernameChangeAt
  if (!t) return ''
  return String(t).replace('T', ' ').slice(0, 10)
})
const favCount = computed(() => favList.value.length)

// 1.2 起：游戏爱好 = 多选游戏；后端返回已解析的 favoriteGames 直接展示。
const favGames = computed(() => userStore.userInfo?.favoriteGames || [])
// 常看板块：从 userInfo.favoriteBoardIds 解析为板块对象
const favBoards = computed(() => {
  const raw = userStore.userInfo?.favoriteBoardIds || ''
  const ids = raw.split(',').map((s) => Number(s.trim())).filter(Boolean)
  const map = Object.fromEntries(allBoards.value.map((b) => [b.id, b]))
  return ids.map((id) => map[id]).filter(Boolean)
})

const tabs = [
  { key: 'home', label: '我的主页' },
  { key: 'posts', label: '我的帖子' },
  { key: 'favorites', label: '我的收藏' },
  { key: 'following', label: '我的关注' },
  { key: 'followers', label: '我的粉丝' },
  { key: 'settings', label: '账号设置' }
]

// 设置表单
const profileForm = ref({
  nickname: '',
  avatar: '',
  bio: '',
  favBoardIdsArr: [],
  favGameIdsArr: []   // 1.2 起：游戏爱好（多选游戏 id）
})
const pwdForm = ref({ oldPassword: '', newPassword: '' })
const saving = ref(false)
const savingPwd = ref(false)
// 修改登录账号
const accountForm = ref({ newUsername: '' })
const savingUser = ref(false)

function syncProfileForm() {
  const u = userStore.userInfo || {}
  profileForm.value = {
    nickname: u.name || '',
    avatar: u.avatar || '',
    bio: u.bio || '',
    favBoardIdsArr: (u.favoriteBoardIds || '')
      .split(',').map((s) => Number(s.trim())).filter(Boolean),
    // 1.2 起：从 favoriteGameIds 解析（字符串 ID → 数字数组）
    favGameIdsArr: (u.favoriteGameIds || '')
      .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  }
}

async function loadCounts() {
  const id = userStore.userInfo?.id
  if (!id) return
  const c = await getFollowCounts(id)
  followingCount.value = c.following || 0
  followersCount.value = c.followers || 0
}

async function loadPoints() {
  if (!userStore.isLoggedIn) {
    userStore.setSignStatus({ points: 0, signedToday: false })
    myContinuous.value = 0
    return
  }
  try {
    const s = await getPointsStatus()
    userStore.setSignStatus({ points: s.totalPoints || 0, signedToday: !!s.signedToday })
    myContinuous.value = s.continuousDays || 0
  } catch (e) {
    userStore.setSignStatus({ points: 0, signedToday: false })
  }
}
async function loadPointsLogs() {
  if (!userStore.isLoggedIn) {
    pointsLogs.value = []
    return
  }
  try {
    const d = await getPointsLogs({ current: 1, size: 8 })
    pointsLogs.value = d.records || []
  } catch (e) {
    pointsLogs.value = []
  }
}
async function doMySignIn() {
  if (mySignLoading.value || mySigned.value) return
  mySignLoading.value = true
  try {
    const r = await signIn()
    // 立刻同步到 store：TopBar 右上角💎/签到按钮无需切换页面就会刷新
    userStore.setSignStatus({ points: r.totalPoints, signedToday: !!r.signedToday })
    myContinuous.value = r.continuousDays || 0
    if (r.signed) ElMessage.success(`签到成功，连续 ${r.continuousDays || 1} 天，+${r.points || 10} 积分 💎`)
    else ElMessage.info('今天已经签到过啦')
    await loadPointsLogs()
  } catch (e) {
    // 拦截器已提示
  } finally {
    mySignLoading.value = false
  }
}

async function loadHomeData() {
  const uid = userStore.userInfo?.id
  myPosts.value = uid ? await getMyPosts(uid) : []
  favList.value = await getFavorites()
}

/**
 * 同步最新的个人统计到 userStore.userInfo（含 likeReceivedCount），
 * 避免顶部「获赞」展示的是登录时的旧缓存值。
 */
async function syncMe() {
  try {
    // getMe() 经 axios 拦截器解包后直接返回 Result.data（用户对象），
    // 没有 code/message 包装；判断用 id 存在性而非 me.code。
    const me = await getMe()
    if (!me || !me.id) return
    const latest = me || {}
    const base = userStore.userInfo || {}
    // 顶部"获赞"使用独立 ref，确保响应式更新（不受 store 缓存影响）
    likeReceivedCount.value = latest.likeReceivedCount ?? 0
    userStore.setUserInfo({
      ...base,
      id: latest.id ?? base.id,
      name: latest.nickname || latest.name || base.name,
      nickname: latest.nickname ?? base.nickname,
      avatar: latest.avatar ?? base.avatar,
      email: latest.email ?? base.email,
      bio: latest.bio ?? base.bio,
      favoriteBoardIds: latest.favoriteBoardIds ?? base.favoriteBoardIds,
      // 1.2 起：游戏爱好（多选游戏）
      favoriteGameIds: latest.favoriteGameIds ?? base.favoriteGameIds ?? '',
      favoriteGames: latest.favoriteGames ?? base.favoriteGames ?? [],
      points: latest.points ?? base.points,
      likeReceivedCount: latest.likeReceivedCount ?? 0,
      activityScore: latest.activityScore ?? base.activityScore,
      activityLevel: latest.activityLevel ?? base.activityLevel,
      roles: latest.roles ?? base.roles,
      badge: latest.badge ?? base.badge,
      badgeColor: latest.badgeColor ?? base.badgeColor,
      badgeText: latest.badgeText ?? base.badgeText,
      moderatorBoardIds: latest.moderatorBoardIds ?? base.moderatorBoardIds ?? [],
      moderatorBoardNames: latest.moderatorBoardNames ?? base.moderatorBoardNames ?? [],
      moderatorGameNames: latest.moderatorGameNames ?? base.moderatorGameNames ?? [],
      // 登录账号相关：当前账号 + 可改状态 + 下次可改时间
      username: latest.username ?? base.username,
      canChangeUsername: latest.canChangeUsername ?? base.canChangeUsername ?? true,
      nextUsernameChangeAt: latest.nextUsernameChangeAt ?? base.nextUsernameChangeAt ?? null
    })
  } catch (e) {
    // 静默失败：保留旧缓存
  }
}

async function loadTab() {
  const uid = userStore.userInfo?.id
  if (tab.value === 'posts') {
    myPosts.value = uid ? await getMyPosts(uid) : []
  } else if (tab.value === 'favorites') {
    favList.value = await getFavorites()
  } else if (tab.value === 'following') {
    followingList.value = (await getFollowing()).records
  } else if (tab.value === 'followers') {
    followersList.value = (await getFollowers()).records
  } else if (tab.value === 'settings') {
    await syncMe()
    syncProfileForm()
    accountForm.value.newUsername = ''
  }
}

function goEditor() {
  router.push('/editor')
}
function goPost(id) {
  router.push(`/post/${id}`)
}
// 被驳回帖：跳编辑页，保存后自动重新提交审核
function goEditPost(p) {
  router.push(`/editor?edit=${p.id}`)
}
function goUser(id) {
  router.push(`/user/${id}`)
}

// ---- 我的帖子管理：隐藏 / 恢复 / 删除 ----
async function doHide(p) {
  try {
    await hidePost(p.id)
    ElMessage.success('帖子已隐藏（其他人不可见，获赞数保留）')
    await refreshAfterManage()
  } catch (e) { /* 拦截器已提示 */ }
}
async function doRestore(p) {
  try {
    await restorePost(p.id)
    ElMessage.success('帖子已恢复可见')
    await refreshAfterManage()
  } catch (e) { /* 拦截器已提示 */ }
}
async function doDelete(p) {
  try {
    await ElMessageBox.confirm(
      `确定删除《${p.title}》吗？删除后不可恢复，帖子数和获赞数都会相应减少。`,
      '删除帖子',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    await deletePost(p.id)
    ElMessage.success('帖子已删除')
    await refreshAfterManage()
  } catch (e) {
    // 用户取消或请求失败
  }
}
async function refreshAfterManage() {
  await syncMe()          // 刷新获赞数
  await loadHomeData()    // 刷新帖子列表
  await loadCounts()
  await loadTab()
}
async function unfollow(u) {
  const r = await toggleFollow(u.id)
  followingList.value = followingList.value.filter((x) => x.id !== u.id)
  followingCount.value = Math.max(0, followingCount.value - 1)
  ElMessage.success(r.followed ? '已重新关注' : '已取消关注')
}
async function followBack(u) {
  const r = await toggleFollow(u.id)
  u.isFollowing = r.followed
  ElMessage.success(r.followed ? '已回关' : '已取消关注')
  await loadCounts()
}

// 上传头像
async function uploadAvatar({ file }) {
  try {
    const url = await uploadImage(file)
    profileForm.value.avatar = url
    ElMessage.success('头像已选择，记得点「保存资料」')
  } catch (e) {
    ElMessage.error('头像上传失败')
  }
}

async function saveProfile() {
  saving.value = true
  try {
    const payload = {
      nickname: profileForm.value.nickname,
      avatar: profileForm.value.avatar,
      bio: profileForm.value.bio,
      favoriteBoardIds: (profileForm.value.favBoardIdsArr || []).join(','),
      // 1.2 起：游戏爱好（多选游戏 id，逗号分隔）
      favoriteGameIds: (profileForm.value.favGameIdsArr || []).join(',')
    }
    const updated = await updateProfile(payload)
    // 同步到 store / localStorage（保留原有字段，并补回 name）
    const base = userStore.userInfo || {}
    const merged = {
      id: base.id,
      name: updated.nickname || base.name,
      avatar: updated.avatar || base.avatar,
      roles: base.roles,
      bio: updated.bio ?? base.bio,
      favoriteBoardIds: updated.favoriteBoardIds ?? base.favoriteBoardIds,
      favoriteGameIds: updated.favoriteGameIds ?? base.favoriteGameIds,
      favoriteGames: updated.favoriteGames ?? base.favoriteGames
    }
    userStore.setUserInfo(merged)
    ElMessage.success('资料已保存')
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function savePassword() {
  if (!pwdForm.value.oldPassword || !pwdForm.value.newPassword) {
    ElMessage.warning('请填写原密码和新密码')
    return
  }
  savingPwd.value = true
  try {
    await updatePassword(pwdForm.value)
    ElMessage.success('密码已更新')
    pwdForm.value = { oldPassword: '', newPassword: '' }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '修改失败')
  } finally {
    savingPwd.value = false
  }
}

async function saveUsername() {
  const name = (accountForm.value.newUsername || '').trim()
  if (!name) {
    ElMessage.warning('请输入新账号')
    return
  }
  if (name.length < 3 || name.length > 20 || !/^[a-zA-Z0-9_]+$/.test(name)) {
    ElMessage.warning('账号需 3-20 位，仅含字母、数字和下划线')
    return
  }
  savingUser.value = true
  try {
    const info = await updateUsername({ username: name })
    const base = userStore.userInfo || {}
    userStore.setUserInfo({
      ...base,
      username: info.username ?? name,
      canChangeUsername: info.canChangeUsername ?? false,
      nextUsernameChangeAt: info.nextUsernameChangeAt ?? null
    })
    accountForm.value.newUsername = ''
    ElMessage.success('账号修改成功，下次登录请使用新账号 @' + (info.username ?? name))
  } catch (e) {
    // 拦截器已提示（含「每年一次」限制、账号被占用等）
  } finally {
    savingUser.value = false
  }
}

function stripEmpty(obj) {
  const out = {}
  for (const k of ['id', 'name', 'nickname', 'avatar', 'email', 'bio', 'favoriteBoardIds', 'favoriteGameIds', 'favoriteGames', 'gender', 'roles']) {
    if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k]
  }
  return out
}

// 路由 query 同步（SideNav 跳转带 ?tab=）
watch(
  () => route.query.tab,
  (t) => {
    tab.value = t || 'home'
  }
)
watch(tab, loadTab)
onMounted(async () => {
  const res = await getBoards()
  allBoards.value = res.parents.flatMap((p) => [p, ...res.childrenOf(p.id)])
  // 1.2 起：加载游戏库全量（用于"游戏爱好"多选）
  try {
    const games = await getGames({ size: 100 })
    allGames.value = games.records || []
  } catch (e) {
    allGames.value = []
  }
  await syncMe()
  await loadCounts()
  await loadPoints()
  await loadPointsLogs()
  await loadHomeData()
  await loadTab()
})
</script>

<style scoped>
.my {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ucard {
  display: flex;
  align-items: center;
  gap: 14px;
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.14), rgba(25, 227, 194, 0.08));
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
}
.u-ava {
  background: var(--bg-2);
  font-size: 22px;
  font-weight: 700;
}
.u-info {
  flex: 1;
}
.u-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 800;
  color: var(--t1);
}
.u-role {
  font-weight: 600 !important;
}
.u-account {
  font-size: 11.5px;
  color: var(--t3);
  background: var(--bg-3);
  border: 1px solid var(--border);
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 500;
  cursor: help;
  white-space: nowrap;
}
.u-boards {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--t3);
  margin: 6px 0 2px;
  flex-wrap: wrap;
}
.u-boards .b-label {
  color: var(--t2);
  font-weight: 600;
}
.b-tag {
  margin-left: 2px;
}
.u-sub {
  font-size: 12px;
  color: var(--t3);
}
.u-stats {
  display: flex;
  gap: 20px;
}
.stat {
  text-align: center;
  color: var(--t2);
}
.stat b {
  display: block;
  font-size: 20px;
  color: var(--brand);
  line-height: 1.1;
}
.stat small {
  font-size: 11px;
  color: var(--t3);
}
.tabs {
  display: flex;
  gap: 6px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 5px;
  flex-wrap: wrap;
}
.tabs button {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--t2);
  font-weight: 600;
  padding: 9px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13.5px;
  white-space: nowrap;
}
.tabs button.active {
  background: var(--brand);
  color: #fff;
}
/* 主页网格 */
.profile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.pcard {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.pcard.span2 {
  grid-column: 1 / -1;
}
.pc-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(124, 92, 255, 0.14);
  color: #c4b5ff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: default;
}
.chip.board {
  text-decoration: none;
  cursor: pointer;
}
.chip.board:hover {
  background: rgba(124, 92, 255, 0.3);
  color: #fff;
}
/* 1.2 起：游戏爱好 chip（含小封面） */
.game-chip-list {
  align-items: center;
}
.chip.game-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 4px;
  text-decoration: none;
  cursor: pointer;
}
.chip.game-chip:hover {
  background: rgba(124, 92, 255, 0.3);
  color: #fff;
}
.gc-cover {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--bg-3);
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: var(--brand);
}
.gc-cover-fallback {
  background: rgba(124, 92, 255, 0.18);
  color: var(--brand);
}
.gc-name {
  line-height: 22px;
}
/* 设置页游戏多选的下拉项 */
.gp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gp-cover {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--bg-3);
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: var(--brand);
}
.gp-cover-fallback {
  background: rgba(124, 92, 255, 0.18);
}
.gp-name {
  font-weight: 600;
  color: var(--t1);
}
.gp-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--t3);
}
/* 积分 / 签到 */
.sign-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.sign-total {
  font-size: 18px;
  font-weight: 800;
  color: #f6c453;
}
.sign-sub {
  font-size: 12px;
  color: var(--t3);
  margin-top: 2px;
}
.plist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
.points-toggles {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.points-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  cursor: pointer;
  color: var(--brand);
  font-size: 13px;
  font-weight: 600;
  user-select: none;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.points-toggle:hover,
.points-toggle.active {
  background: var(--brand-soft);
  color: #6a4cf0;
}
.pt-caret {
  transition: transform 0.2s;
}
.pt-caret.open {
  transform: rotate(180deg);
}
.plist-wrap {
  margin-top: 8px;
}
.prow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.ptype {
  flex: none;
  color: var(--brand);
  background: var(--brand-soft);
  padding: 1px 8px;
  border-radius: 999px;
  font-weight: 600;
}
.pdesc {
  flex: 1;
  color: var(--t2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pdelta {
  flex: none;
  font-weight: 700;
}
.pdelta.up {
  color: #4fd1c5;
}
.pdelta.down {
  color: #f87171;
}
.muted {
  font-size: 12.5px;
  color: var(--t3);
  margin: 0;
}
.follow-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ---- 我的帖子管理列表 ---- */
.my-post-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.my-post-item:hover {
  border-color: var(--brand);
  background: var(--bg-3);
}
.m-p-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.m-p-title {
  font-weight: 600;
  color: var(--t1);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-p-title:hover {
  color: var(--brand);
}
.m-p-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12.5px;
  color: var(--t3);
}
.m-p-time {
  margin-left: auto;
}
.m-p-actions {
  display: flex;
  gap: 8px;
}
.follow-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
}
.f-user {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  border-radius: 8px;
  padding: 4px 6px;
  margin: -4px -6px;
  transition: background 0.15s;
}
.f-user:hover {
  background: var(--bg-3);
}
.f-user:hover .f-name {
  color: var(--brand);
}
.f-ava {
  background: var(--bg-3);
}
.f-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.f-name {
  font-weight: 600;
  color: var(--t1);
}
.f-bio {
  font-size: 12px;
  color: var(--t3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 设置表单 */
.settings {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.set-form {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.avatar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ava-url {
  flex: 1;
  min-width: 160px;
}
.board-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}
.acc-now {
  font-size: 14px;
  font-weight: 700;
  color: var(--brand);
  font-family: var(--font-num);
}
.acc-change {
  display: flex;
  gap: 8px;
  width: 100%;
}
.acc-change .el-input {
  flex: 1;
}
.acc-tip {
  font-size: 12px;
  color: var(--t3);
  line-height: 1.5;
}
.acc-lock {
  margin-top: 2px;
}
@media (max-width: 760px) {
  .profile-grid,
  .settings {
    grid-template-columns: 1fr;
  }
}
</style>
