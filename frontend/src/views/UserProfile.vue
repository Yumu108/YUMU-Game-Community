<template>
  <AppLayout>
    <BackButton />
    <div class="profile" v-loading="loading">
      <!-- 9-08：id 非法/用户不存在 → 友好占位 -->
      <el-empty v-if="notFound" description="用户不存在或链接无效" :image-size="90" />
      <template v-else>
      <div class="hero">
        <AvatarPreview :size="72" :src="profile.avatar" :name="profile.nickname || profile.username" class="hero-ava" />
        <div class="hero-info">
          <div class="hero-name">
            <span class="hn-nick">{{ profile.nickname || profile.username }}</span>
            <span class="hero-account">账号id:{{ profile.username }}</span>
            <el-tag
              v-if="profile.badge === 'ADMIN'"
              type="danger"
              size="small"
              effect="dark"
              class="role-tag"
            >🛡️ 管理员</el-tag>
            <el-tag
              v-else-if="profile.badge === 'MODERATOR'"
              type="warning"
              size="small"
              effect="dark"
              class="role-tag"
              :title="modBadgeTip"
            >⭐ {{ modBadgeText }}</el-tag>
            <el-tag v-else-if="profile.badge === 'SUB_MODERATOR'" type="primary" size="small" effect="dark" class="role-tag">🔹 子版主</el-tag>
          </div>
          <div v-if="profile.moderatorBoardNames && profile.moderatorBoardNames.length" class="hero-boards">
            <el-icon class="b-ico"><Flag /></el-icon>
            负责板块：
            <el-tag
              v-for="(n, i) in profile.moderatorBoardNames"
              :key="profile.moderatorBoardIds[i] || n"
              size="small"
              type="info"
              effect="plain"
              class="b-tag"
            >{{ n }}</el-tag>
          </div>
          <div class="hero-bio">{{ profile.bio || '这个人很神秘，什么都没留下' }}</div>
          <div class="hero-stats">
            <span><b>{{ profile.postCount }}</b> 帖</span>
            <span><b>{{ profile.likeReceivedCount ?? 0 }}</b> 获赞</span>
            <span><b>{{ profile.followingCount }}</b> 关注</span>
            <span><b>{{ profile.followersCount }}</b> 粉丝</span>
          </div>
        </div>
        <div class="hero-actions">
          <el-button v-if="isSelf" round plain @click="goMy">个人中心</el-button>
          <template v-else>
            <el-button
              v-if="userStore.isLoggedIn"
              :type="profile.isFollowed ? 'info' : 'primary'"
              round
              @click="onToggleFollow"
            >{{ profile.isFollowed ? '已关注' : '关注' }}</el-button>
            <el-button v-if="userStore.isLoggedIn" round plain @click="goChat">私信</el-button>
            <!-- 9-07：个人主页举报 → 走与帖子/回复统一的举报接口（targetType=3 用户） -->
            <el-button
              v-if="userStore.isLoggedIn"
              text
              size="small"
              class="hero-report"
              @click="openReport"
            >
              <el-icon><Warning /></el-icon> 举报
            </el-button>
          </template>
        </div>
      </div>

      <div class="prefs">
        <section class="pref-card">
          <h3 class="pref-title">🎮 游戏爱好</h3>
          <div v-if="favGames.length" class="chip-list">
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
          <p v-else class="muted">TA 还没有选游戏爱好</p>
        </section>

        <section class="pref-card">
          <h3 class="pref-title">📌 常看板块</h3>
          <div v-if="favBoards.length" class="chip-list">
            <router-link
              v-for="b in favBoards"
              :key="b.id"
              :to="`/board/${b.id}`"
              class="chip board-chip"
            >{{ b.emoji }} {{ b.name }}</router-link>
          </div>
          <p v-else class="muted">TA 还没有设置常看板块</p>
        </section>
      </div>

      <div class="posts">
        <div class="section-title">TA 的帖子</div>
        <PostCard v-for="p in profile.posts" :key="p.id" :post="p" />
        <el-empty v-if="profile.posts.length === 0" description="TA 还没有发过帖" :image-size="90" />
      </div>
      </template>
    </div>

    <!-- 9-07：举报弹窗（targetType=3 用户；与帖子/回复共用 submitReport） -->
    <el-dialog v-model="reportVisible" title="举报用户" width="420px" align-center>
      <p class="rep-tip">请描述该用户存在的问题（骚扰、违规、冒充等），管理员会尽快处理。</p>
      <el-input
        v-model="reportReason"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="举报理由…"
      />
      <template #footer>
        <el-button @click="reportVisible = false">取消</el-button>
        <el-button type="danger" :loading="reportSubmitting" @click="submitReportNow">提交举报</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Flag, Warning } from '@element-plus/icons-vue'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import PostCard from '@/components/PostCard.vue'
import AvatarPreview from '@/components/AvatarPreview.vue'
import { getUserProfile, toggleFollow, submitReport } from '@/api/community'
import { useUserStore } from '@/store'
import { FIXED_BOARDS, findBoard } from '@/constants/boards'

// 9-07：举报弹窗状态（targetType=3 用户）
const reportVisible = ref(false)
const reportReason = ref('')
const reportSubmitting = ref(false)

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const profile = ref({ posts: [], favoriteGames: [], favoriteBoardIds: '' })
// 9-08：id 非数字或用户不存在时显示友好占位（不再发请求/不再 500 报错）
const notFound = ref(false)

const isSelf = computed(
  () => userStore.userInfo && String(userStore.userInfo.id) === String(route.params.id)
)
const initial = computed(() => (profile.value.nickname || profile.value.username || '?').charAt(0))
// 1.2 起：版主徽章拼上负责游戏名 + tooltip 列出全部
const modBadgeText = computed(() => {
  const names = profile.value.moderatorGameNames || []
  if (names.length === 0) return '版主'
  const extra = names.length - 1
  return `版主 · ${names[0]}${extra > 0 ? ` (+${extra})` : ''}`
})
const modBadgeTip = computed(() => {
  const names = profile.value.moderatorGameNames || []
  if (names.length === 0) return '当前账号尚未分配负责游戏'
  if (names.length === 1) return `负责游戏：${names[0]}`
  return `负责游戏（${names.length} 个）：${names.join('、')}`
})
// 1.2 起：游戏爱好（后端已解析为 favoriteGames）
const favGames = computed(() => profile.value.favoriteGames || [])
// 1.2 起：常看板块（favoriteBoardIds 逗号 ID 串 → 用 FIXED_BOARDS 解析为带 emoji 的板块对象）
const favBoards = computed(() => {
  const raw = profile.value.favoriteBoardIds || ''
  return raw.split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((id) => findBoard(id))
    .filter(Boolean)
})

async function load() {
  // 9-08：防篡改提及链接（如 /user/1的02）——非纯数字 id 直接判无效，不发请求
  if (!/^\d+$/.test(String(route.params.id || ''))) {
    notFound.value = true
    return
  }
  loading.value = true
  notFound.value = false
  try {
    profile.value = await getUserProfile(route.params.id)
  } catch (e) {
    // 用户不存在（404）等 → 友好占位；错误 toast 由 request 拦截器统一弹
    notFound.value = true
  } finally {
    loading.value = false
  }
}

async function onToggleFollow() {
  await toggleFollow(route.params.id)
  await load()
  ElMessage.success(profile.value.isFollowed ? '已关注' : '已取消关注')
}

function goMy() {
  router.push('/my')
}
function goChat() {
  router.push(`/messages/${route.params.id}`)
}

// ---- 9-07：举报用户（type=3） ----
function openReport() {
  if (!userStore.isLoggedIn) return ElMessage.warning('请先登录')
  if (isSelf.value) return ElMessage.warning('不能举报自己')
  reportReason.value = ''
  reportVisible.value = true
}
async function submitReportNow() {
  const reason = reportReason.value.trim()
  if (!reason) return ElMessage.warning('请填写举报理由')
  reportSubmitting.value = true
  try {
    await submitReport({ targetType: 3, targetId: profile.value.id, reason })
    ElMessage.success('举报已提交，管理员会尽快处理')
    reportVisible.value = false
  } catch (e) {
    // 业务失败由 request 拦截器统一 toast
  } finally {
    reportSubmitting.value = false
  }
}

onMounted(load)
watch(() => route.params.id, load)
</script>

<style scoped>
.profile {
  max-width: 820px;
  margin: 0 auto;
}
.hero {
  display: flex;
  gap: 18px;
  padding: 20px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 16px;
}
.hero-ava {
  background: var(--brand-soft);
  color: var(--brand);
  font-weight: 800;
  font-size: 28px;
  flex-shrink: 0;
}
.hero-info {
  flex: 1;
  min-width: 0;
}
.hero-name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 20px;
  font-weight: 800;
  color: var(--t1);
}
.hero-account {
  font-size: 13px;
  font-weight: 500;
  color: var(--t3);
  font-family: var(--font-num);
}
.role-tag {
  font-weight: 600 !important;
}
.hero-boards {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--t3);
  margin: 8px 0 4px;
  flex-wrap: wrap;
}
.hero-boards .b-ico {
  color: var(--brand);
}
.b-tag {
  margin-left: 2px;
}
.hero-bio {
  font-size: 13px;
  color: var(--t3);
  margin: 6px 0 10px;
}
.hero-stats {
  display: flex;
  gap: 18px;
  font-size: 13px;
  color: var(--t2);
}
.hero-stats b {
  color: var(--t1);
  margin-right: 2px;
}
.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}
/* 9-07：个人主页举报按钮 */
.hero-report {
  color: var(--t3);
  font-size: 12.5px;
}
.hero-report:hover {
  color: var(--danger, #f56c6c);
}
.rep-tip {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--t3);
  line-height: 1.6;
}
.posts {
  min-height: 200px;
}
.section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--t1);
  margin: 4px 0 12px;
}
/* 1.2 起：游戏爱好 + 常看板块卡片 */
.prefs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}
.pref-card {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.pref-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--t1);
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.chip {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(124, 92, 255, 0.14);
  color: #c4b5ff;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  cursor: default;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.chip.board-chip,
.chip.game-chip {
  cursor: pointer;
}
.chip.board-chip:hover,
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
.muted {
  font-size: 12.5px;
  color: var(--t3);
  margin: 0;
}
@media (max-width: 700px) {
  .hero {
    flex-wrap: wrap;
  }
  .hero-actions {
    flex-direction: row;
    width: 100%;
    justify-content: flex-end;
  }
  .prefs {
    grid-template-columns: 1fr;
  }
}
</style>
