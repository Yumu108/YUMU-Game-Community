<template>
  <AppLayout>
    <BackButton />
    <div v-if="post" class="detail">
      <!-- 隐藏帖预览横幅：仅管理员 / 负责该(游戏,板块)的版主能看到 -->
      <!-- 预览横幅：管理员 / 版主预览非公开帖（2026-09-08：待审核帖也可预览，文案随状态区分） -->
      <div v-if="post.previewOnly" class="d-preview-banner">
        <el-icon class="d-preview-icon"><Warning /></el-icon>
        <span>
          <b>{{ post.status === 2 ? '待审核帖预览模式' : '隐藏帖预览模式' }}</b>
          —— 你正在以「{{ previewRoleText }}」身份预览该{{ post.status === 2 ? '尚未通过审核的帖子' : '已被隐藏/驳回的帖子' }}。此处操作不计入浏览量，回帖/点赞/收藏/举报已禁用。
        </span>
      </div>

      <!-- 待审核提示：待审帖仅作者本人可日常浏览（管理员/版主走上面的预览模式） -->
      <div v-if="post.status === 2 && !post.previewOnly" class="d-review-banner pending">
        <el-icon class="d-preview-icon"><Warning /></el-icon>
        <span>
          <b>{{ post.resubmitAt ? '🔁 该帖子已重新提交审核（待重审）' : '⏳ 该帖子正在审核中' }}</b>
          —— 审核通过后其他用户才能看到。审核期间点赞、收藏、举报等互动均不可用，请耐心等待。
        </span>
      </div>

      <!-- 驳回提示：作者本人看到的被驳回帖，可重新编辑提审 -->
      <div v-if="isRejected" class="d-review-banner rejected">
        <el-icon class="d-preview-icon"><CircleCloseFilled /></el-icon>
        <span class="d-reject-text">
          <b>✖ 该帖子未通过审核</b>
          <template v-if="post.rejectReason">，驳回理由：{{ post.rejectReason }}</template>
          。你可以修改内容后重新提交审核。
        </span>
        <el-button size="small" type="danger" round class="d-reject-btn" @click="goEdit">重新编辑并提交审核</el-button>
      </div>

      <!-- 面包屑 -->
      <div class="crumb">
        <router-link to="/" class="link">综合首页</router-link>
        <span class="sep">/</span>
        <router-link :to="`/board/${post.boardId}`" class="link">{{ post.boardName }}</router-link>
      </div>

      <!-- 标题区：状态角标 + 板块标签 -->
      <div class="d-head">
        <div class="d-badges">
          <StatusBadge :is-top="post.isTop" :is-essence="post.isEssence" :status="post.status" :reject-reason="post.rejectReason" :resubmit-at="post.resubmitAt" />
          <BoardTag :text="post.boardTag" />
        </div>
        <h1 class="d-title">{{ post.title }}</h1>
        <div class="d-meta">
          <router-link :to="`/user/${post.userId}`" class="d-author-link">
            <el-avatar :size="30" :src="post.avatar" class="d-ava">{{ post.author?.[0] || '游' }}</el-avatar>
            <span class="d-author">{{ post.author }}</span>
            <el-tag
              v-if="post.authorBadge"
              :type="post.authorBadgeColor"
              size="small"
              effect="dark"
              :title="badgeTitle(post.authorBadge, post.authorModeratorGameNames)"
              class="d-badge"
            >{{ badgeText(post.authorBadge, post.authorModeratorGameNames) }}</el-tag>
            <el-tag
              size="small"
              effect="plain"
              class="d-level"
              :class="`lv-${post.authorLevel || 1}`"
            >{{ cleanLevelTitle(post.authorLevel, post.authorLevelTitle) }}</el-tag>
          </router-link>
          <span class="d-time num">发布于 {{ post.createdAt }}</span>
          <el-button
            v-if="canFollow"
            size="small"
            :type="followed ? 'info' : 'primary'"
            round
            plain
            class="d-follow"
            @click="onFollow"
          >
            {{ followed ? '已关注' : '+ 关注' }}
          </el-button>
          <div class="d-stats">
            <span><el-icon><ChatDotRound /></el-icon>{{ post.replyCount }} 回复</span>
            <span><ThumbUp :size="16" />{{ post.likeCount }} 点赞</span>
            <span><el-icon><View /></el-icon>{{ post.viewCount }} 浏览</span>
          </div>
        </div>
      </div>

      <!-- 话题标签 -->
      <div v-if="post.tags && post.tags.length" class="d-tags">
        <router-link
          v-for="t in post.tags"
          :key="t.id"
          :to="`/tag/${t.id}`"
          class="d-tag"
        >#{{ t.name }}</router-link>
      </div>

      <!-- 正文（富文本 HTML 渲染；XSS 净化留待阶段5 安全测试） -->
      <div class="d-body" v-html="renderRichText(post.content || post.excerpt)"></div>

      <!-- 操作栏：点赞 / 收藏 / 举报（预览态 + 非公开帖（待审核/隐藏）禁用，避免污染数据） -->
      <div v-if="!isPreviewOnly && post.status === 0" class="d-actions">
        <el-button :type="liked ? 'primary' : 'default'" round @click="onLike">
          <ThumbUp :size="15" :active="liked" /> {{ liked ? '已赞' : '点赞' }} {{ post.likeCount }}
        </el-button>
        <el-button :type="favorited ? 'warning' : 'default'" round @click="onFavorite">
          <el-icon><Star /></el-icon> {{ favorited ? '已收藏' : '收藏' }}
        </el-button>
        <el-button v-if="userStore.isLoggedIn" text size="small" class="d-report" @click="openReport">
          <el-icon><Warning /></el-icon> 举报
        </el-button>
      </div>

      <!-- 管理工具栏（仅管理员可见；后端再次做角色校验） -->
      <div v-if="userStore.isAdmin" class="d-admin">
        <span class="d-admin-label">管理操作</span>
        <el-button size="small" :type="post.isTop ? 'success' : 'default'" round @click="adminPin" :loading="adminBusy">
          {{ post.isTop ? '取消置顶' : '置顶' }}
        </el-button>
        <el-button size="small" :type="post.isEssence ? 'warning' : 'default'" round @click="adminEssence" :loading="adminBusy">
          {{ post.isEssence ? '取消加精' : '加精' }}
        </el-button>
        <el-button size="small" :type="isHidden ? 'info' : 'danger'" round plain @click="adminToggleHide" :loading="adminBusy" v-if="!isRejected">
          {{ isHidden ? '恢复展示' : '隐藏帖子' }}
        </el-button>
      </div>

      <!-- 作者操作（仅帖子作者本人，非管理员时也显示；后端校验权限） -->
      <div
        v-if="userStore.isLoggedIn && !userStore.isAdmin && post.userId === userStore.userInfo?.id"
        class="d-admin d-owner"
      >
        <span class="d-admin-label">我的操作</span>
        <el-button size="small" type="primary" round plain @click="goEdit">
          {{ isRejected ? '编辑并重新提审' : '编辑帖子' }}
        </el-button>
        <el-button v-if="!isRejected" size="small" :type="isHidden ? 'info' : 'warning'" round plain @click="ownerToggleHide" :loading="ownerBusy">
          {{ isHidden ? '恢复可见' : '隐藏帖子' }}
        </el-button>
        <el-button size="small" type="danger" round plain @click="ownerDelete" :loading="ownerBusy">删除帖子</el-button>
      </div>

      <!-- 回帖（预览态禁用：只看帖，不能回帖/楼中楼） -->
      <!-- 9-07 第三次重构：平铺式楼中楼（4399 / B 站风格）—— 主回复 + 子评论区平铺展示 -->
      <div v-if="!isPreviewOnly && (replyTotal > 0 || post.status === 0)" class="replies">
        <div class="section-title">💬 全部回帖（{{ replyTotal }}）</div>
        <MainReply
          v-for="r in replies"
          :key="r.id"
          :reply="r"
          :can-delete="canDeleteReply(r)"
          :can-report="userStore.isLoggedIn"
          :liked-set="likedReplies"
          :highlight-id="highlightReplyId"
          @like="onReplyLike"
          @reply="openReply"
          @report="openReplyReport"
          @delete="deleteOneReply"
        />
      </div>

      <!-- 相关推荐 -->
      <div v-if="related.length" class="related">
        <div class="section-title">📎 相关推荐</div>
        <ul class="rel-list">
          <li v-for="r in related" :key="r.id" class="rel-item" @click="goPost(r.id)">
            <span class="rel-title">{{ r.title }}</span>
            <span class="rel-meta num">{{ r.replyCount }} 回 · {{ r.likeCount }} 赞</span>
          </li>
        </ul>
      </div>

      <!-- 发表回帖（预览态 + 非公开帖禁用；2026-09-08：锁定时给出可读原因） -->
      <div v-if="canReply" class="reply-box">
        <div class="section-title">✍️ 发表回帖</div>
        <!-- 富文本编辑器：支持图片 + 链接 + @提及自动变可点击链接（与发帖同款 RichEditor） -->
        <RichEditor v-model="replyText" :placeholder="replyTo ? '回复楼主…' : '说点什么吧～'" />
        <div class="rb-actions">
          <el-button v-if="replyTo" text size="small" @click="replyTo = null">取消回复</el-button>
          <el-button type="primary" size="small" @click="sendReply">发送</el-button>
        </div>
      </div>
      <div v-else-if="replyLockedReason" class="reply-locked">
        {{ replyLockedReason }}
      </div>
    </div>

    <el-skeleton v-else :rows="8" animated />

    <!-- 1.2：楼中楼回复弹窗（点击回复按钮弹出，带被回复者预览 + 富文本编辑器 + 取消/发送） -->
    <el-dialog
      v-model="replyDialogVisible"
      title="💬 我要回复"
      width="540px"
      align-center
      :show-close="true"
      @close="closeReplyDialog"
    >
      <div v-if="replyTarget" class="rd-quote">
        <div class="rd-quote-head">
          <el-avatar :size="28" :src="replyTarget.avatar" />
          <b class="rd-quote-author">{{ replyTarget.author }}</b>
          <span v-if="replyTarget.replyToName" class="rd-quote-to">
            回复 <b>@{{ replyTarget.replyToName }}</b>
          </span>
          <span v-else class="rd-quote-to">的回复</span>
        </div>
        <div
          class="rd-quote-body"
          v-html="renderRichText(replyTarget.content || '')"
        ></div>
      </div>
      <div class="rd-body">
        <RichEditor
          ref="replyEditorRef"
          v-model="replyText"
          :placeholder="replyTarget ? `回复 @${replyTarget.author}：` : '说点什么吧～'"
        />
      </div>
      <template #footer>
        <el-button size="small" @click="closeReplyDialog">取消</el-button>
        <el-button size="small" type="primary" :loading="replySubmitting" @click="submitReplyDialog">发送</el-button>
      </template>
    </el-dialog>

    <!-- 举报弹窗（统一支持帖子 targetType=1 / 回复 targetType=2） -->
    <el-dialog v-model="reportVisible" :title="reportTarget?.type === 2 ? '举报回复' : '举报帖子'" width="420px" align-center>
      <p class="rep-tip">请描述该{{ reportTarget?.type === 2 ? '回复' : '帖子' }}存在的问题（广告、违规内容、抄袭等），管理员会尽快处理。</p>
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
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppLayout from '@/layout/AppLayout.vue'
import BackButton from '@/components/BackButton.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import BoardTag from '@/components/BoardTag.vue'
import MainReply from '@/components/MainReply.vue'
import { useUserStore } from '@/store'
import { renderRichText } from '@/utils/richtext'
import { clearAllSnaps } from '@/utils/swrCache'
import RichEditor from '@/components/RichEditor.vue'
import {
  getPostDetail,
  getReplies,
  getPosts,
  toggleLike,
  toggleFavorite,
  toggleReplyLike,
  addReply,
  checkFollow,
  toggleFollow,
  submitReport,
  adminPinPost,
  adminEssencePost,
  adminHidePost,
  adminRestorePost,
  deletePost,
  deleteReply,
  hidePost,
  restorePost
} from '@/api/community'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const post = ref(null)
const replies = ref([])
const related = ref([])
const liked = ref(false)
const favorited = ref(false)
const followed = ref(false)
// 9-07 楼中楼优化：扁平回帖 + 4399 风格操作栏（点赞 / 回复 / 举报）
// likedReplies 用本地 Set 维护点赞态（与帖子点赞逻辑一致，避免每次刷新都重置）
const likedReplies = ref(new Set())
const replyText = ref('')
const replyTo = ref(null)
const highlightReplyId = ref(null)
let highlightTimer = null // 9-07：避免快速点不同通知时计时器叠加
// 1.2：楼中楼回复弹窗状态
const replyDialogVisible = ref(false)
const replyTarget = ref(null) // 被回复的回复对象（含 author/content/replyToName 等）
const replyEditorRef = ref(null)
const replySubmitting = ref(false)

// 举报弹窗：支持帖子（targetType=1）和回复（targetType=2）两种场景
const reportVisible = ref(false)
const reportReason = ref('')
const reportSubmitting = ref(false)
const reportTarget = ref(null) // { type: 1|2, id, label } null=未发起

// 预览态：操作禁用标识
const isPreviewOnly = computed(() => !!post.value?.previewOnly)
// 预览横幅里的角色文案（管理员 / 版主），用于提示「以什么身份预览」
const previewRoleText = computed(() => {
  if (!isPreviewOnly.value) return ''
  return userStore.isAdmin ? '管理员' : '版主'
})

// 2026-09-08：非公开帖（待审核 / 已隐藏·驳回）的回帖锁
// —— 后端会直接拒绝，与其让用户写完点发送才报错，不如提前锁定并把原因写在界面上
const canReply = computed(
  () => !!post.value && !post.value.previewOnly && post.value.status === 0
)
const replyLockedReason = computed(() => {
  const p = post.value
  if (!p || p.previewOnly || p.status === 0) return ''
  if (p.status === 2) return '⏳ 帖子正在审核中，审核通过后才能评论'
  if (p.status === 1) {
    return p.rejectReason ? '✖ 该帖未通过审核，暂不支持评论' : '🙈 帖子已隐藏，暂不支持评论'
  }
  return ''
})

// 身份徽章文本映射（改用纯文字 + 颜色方案，避开 emoji 在某些字体里渲染为方框）
// 1.2 起版主按 (游戏, 板块) 授权，徽章会拼上第一个负责游戏名；剩余游戏放 tooltip。
function badgeText(code, gameNames) {
  const base = { ADMIN: '管理员', MODERATOR: '版主', SUB_MODERATOR: '子板主' }[code] || ''
  if (code === 'MODERATOR' && Array.isArray(gameNames) && gameNames.length > 0) {
    const extra = gameNames.length - 1
    return `${base} · ${gameNames[0]}${extra > 0 ? ` (+${extra})` : ''}`
  }
  return base
}
// tooltip：MODERATOR 时列出全部负责游戏；其他角色返回空
function badgeTitle(code, gameNames) {
  if (code !== 'MODERATOR') return ''
  if (!Array.isArray(gameNames) || gameNames.length === 0) return '当前账号尚未分配负责游戏'
  if (gameNames.length === 1) return `负责游戏：${gameNames[0]}`
  return `负责游戏（${gameNames.length} 个）：${gameNames.join('、')}`
}
// 身份徽章颜色
function badgeClass(code) {
  return {
    ADMIN: 'badge-admin',
    MODERATOR: 'badge-mod',
    SUB_MODERATOR: 'badge-sub'
  }[code] || ''
}
// 清洗等级称号：去掉 emoji，避免在某些字体里渲染成 ☐
const LEVEL_TITLES_PLAIN = {
  1: '初出茅庐',
  2: '活跃玩家',
  3: '资深玩家',
  4: '社区精英',
  5: '传说玩家'
}
function cleanLevelTitle(level, fallback) {
  const n = Number(level)
  return LEVEL_TITLES_PLAIN[n] || (fallback ? fallback.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, '').trim() : '') || '初出茅庐'
}

// 管理工具栏（仅管理员可见）
const adminBusy = ref(false)
const isHidden = computed(() => post.value?.status === 1)
// 已驳回帖：status=1 且带驳回理由（与作者自隐藏区分，不能一键恢复，只能编辑后重新提审）
const isRejected = computed(() => post.value?.status === 1 && !!post.value?.rejectReason)

// 9-07 平铺式楼中楼：replyTotal = 主回复数 + 所有子评论数（任何深度的楼中楼都计入）
const replyTotal = computed(() => {
  let n = replies.value.length
  replies.value.forEach((r) => { n += (r.children || []).length })
  return n
})

// 仅当登录且不是本人帖子时，才显示「关注」按钮
const canFollow = computed(() => {
  if (!userStore.isLoggedIn || !post.value) return false
  return post.value.userId !== userStore.userInfo?.id
})

async function refresh() {
  const [p, r] = await Promise.all([
    getPostDetail(route.params.id),
    getReplies(route.params.id)
  ])
  post.value = p
  replies.value = r
  // 拉取关注状态
  if (canFollow.value) {
    followed.value = !!(await checkFollow(post.value.userId)).followed
  }
  // 相关推荐：同板块其他帖，取前 5 条
  if (p && p.boardId) {
    const data = await getPosts({ boardId: p.boardId, current: 1, size: 8 })
    related.value = data.records
      .filter((x) => x.id !== p.id)
      .slice(0, 5)
  }
  // 若 URL 携带 replyId，滚动到对应回复并高亮
  scrollToReply()
}

function scrollToReply() {
  const rid = route.query.replyId
  if (!rid) {
    highlightReplyId.value = null
    return
  }
  const id = Number(rid)
  highlightReplyId.value = id
  // 多次触发清理（如快速点不同通知）：清理上一个 timer
  if (highlightTimer) clearTimeout(highlightTimer)
  // 9-07：增加重试——replies 异步 fetch 后 nextTick 时 reply 元素可能还没渲染到 DOM
  let attempts = 0
  const tryScroll = () => {
    let el = document.getElementById(`reply-${id}`) || document.getElementById(`sub-reply-${id}`)
    if (el) {
      // 9-07：用 window.scrollTo 兜底（scrollIntoView 在某些浏览器/页面布局下失效）
      const rect = el.getBoundingClientRect()
      const targetY = window.scrollY + rect.top - window.innerHeight * 0.3
      window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
      // 备选：scrollIntoView 二次调用以确保生效
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (e) { /* 兼容旧浏览器 */ }
      highlightTimer = setTimeout(() => {
        if (highlightReplyId.value === id) highlightReplyId.value = null
        highlightTimer = null
      }, 6000)
    } else if (attempts++ < 20) {
      // 9-07：最多重试 20 次（1.6s 窗口），覆盖 replies 异步渲染延迟
      setTimeout(tryScroll, 80)
    } else {
      // 元素始终未找到（replyId 对应回复被删/隐藏），静默失败
      highlightReplyId.value = null
    }
  }
  nextTick(tryScroll)
}

function goPost(id) {
  router.push(`/post/${id}`)
}
// 9-07 楼中楼优化：扁平回帖后不再需要 children 折叠（shownChildren / toggleSub 已删除）

async function onFollow() {
  if (!requireLogin() || !post.value) return
  const res = await toggleFollow(post.value.userId)
  followed.value = res.followed
  ElMessage.success(followed.value ? `已关注 ${post.value.author}` : `已取消关注 ${post.value.author}`)
}

function requireLogin() {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录后再操作')
    return false
  }
  return true
}
async function onLike() {
  if (!requireLogin() || !post.value) return
  const res = await toggleLike(post.value.id)
  liked.value = res.liked
  post.value.likeCount = res.likeCount
}
async function onFavorite() {
  if (!requireLogin() || !post.value) return
  const res = await toggleFavorite(post.value.id)
  favorited.value = res.favorited
  ElMessage.success(favorited.value ? '已加入收藏' : '已取消收藏')
}
function openReply(target) {
  // 9-07：楼中楼递归，ReplyItem 直接 emit(reply) 对象，无需按 id 反查
  replyTarget.value = target
  replyText.value = ''
  replyDialogVisible.value = true
  // 等弹窗打开后聚焦富文本
  nextTick(() => replyEditorRef.value?.focus?.())
}

// 9-07：楼中楼版已删除 findReplyById（ReplyItem emit 直接传 reply 对象，openReply 用 target 参数）。

function closeReplyDialog() {
  replyDialogVisible.value = false
  replyTarget.value = null
  replyText.value = ''
}

async function submitReplyDialog() {
  if (!requireLogin()) return
  const text = replyText.value.trim()
  if (!text) return ElMessage.warning('回帖内容不能为空')
  if (!replyTarget.value) return
  replySubmitting.value = true
  try {
    await addReply(route.params.id, {
      content: text,
      replyToId: replyTarget.value.id
    })
    ElMessage.success('回复成功')
    closeReplyDialog()
    await refresh()
  } finally {
    replySubmitting.value = false
  }
}

async function sendReply() {
  if (!requireLogin()) return
  const text = replyText.value.trim()
  if (!text) return ElMessage.warning('回帖内容不能为空')
  await addReply(route.params.id, { content: text })
  replyText.value = ''
  await refresh()
  ElMessage.success('回帖成功')
}

// ---- 举报 ----
// ---- 举报（统一弹窗：帖子 type=1 / 回复 type=2） ----
function openReport() {
  if (!requireLogin()) return
  reportReason.value = ''
  reportTarget.value = { type: 1, id: post.value.id }
  reportVisible.value = true
}
// 9-07：回复举报入口（回复区操作栏「举报」按钮）
function openReplyReport(r) {
  if (!requireLogin()) return
  reportReason.value = ''
  reportTarget.value = { type: 2, id: r.id }
  reportVisible.value = true
}
async function submitReportNow() {
  const reason = reportReason.value.trim()
  if (!reason) return ElMessage.warning('请填写举报理由')
  if (!reportTarget.value) return ElMessage.warning('举报目标缺失')
  reportSubmitting.value = true
  try {
    await submitReport({
      targetType: reportTarget.value.type,
      targetId: reportTarget.value.id,
      reason
    })
    ElMessage.success('举报已提交，管理员会尽快处理')
    reportVisible.value = false
    reportTarget.value = null
  } catch (e) {
    // 业务失败由 request 拦截器统一 toast
  } finally {
    reportSubmitting.value = false
  }
}

// ---- 9-07：回复点赞（前端 Set 维护状态，刷新会丢，但比多一次请求轻量） ----
async function onReplyLike(r) {
  if (!requireLogin()) return
  // 乐观更新：先翻转本地状态 + 增减计数（接口失败再回滚）
  const wasLiked = likedReplies.value.has(r.id)
  const prevCount = r.likeCount || 0
  if (wasLiked) {
    likedReplies.value.delete(r.id)
    r.likeCount = Math.max(0, prevCount - 1)
  } else {
    likedReplies.value.add(r.id)
    r.likeCount = prevCount + 1
  }
  // 触发响应式（Set 的 add/delete 不触发 ref 重新渲染，需整体替换）
  likedReplies.value = new Set(likedReplies.value)
  try {
    const res = await toggleReplyLike(r.id)
    if (typeof res?.likeCount === 'number') r.likeCount = res.likeCount
    if (typeof res?.liked === 'boolean') {
      if (res.liked) likedReplies.value.add(r.id)
      else likedReplies.value.delete(r.id)
      likedReplies.value = new Set(likedReplies.value)
    }
  } catch (e) {
    // 失败回滚
    if (wasLiked) likedReplies.value.add(r.id)
    else likedReplies.value.delete(r.id)
    r.likeCount = prevCount
    likedReplies.value = new Set(likedReplies.value)
  }
}

// ---- 管理操作（仅管理员，后端再次做角色校验） ----
async function adminPin() {
  if (!post.value) return
  adminBusy.value = true
  try {
    const r = await adminPinPost(post.value.id)
    post.value.isTop = !!r.isTop
    ElMessage.success(post.value.isTop ? '已置顶' : '已取消置顶')
  } finally {
    adminBusy.value = false
  }
}
async function adminEssence() {
  if (!post.value) return
  adminBusy.value = true
  try {
    const r = await adminEssencePost(post.value.id)
    post.value.isEssence = !!r.isEssence
    ElMessage.success(post.value.isEssence ? '已加精' : '已取消加精')
  } finally {
    adminBusy.value = false
  }
}
async function adminToggleHide() {
  if (!post.value) return
  adminBusy.value = true
  try {
    if (isHidden.value) {
      await adminRestorePost(post.value.id)
      post.value.status = 0
      ElMessage.success('已恢复展示')
    } else {
      await adminHidePost(post.value.id)
      post.value.status = 1
      ElMessage.success('已隐藏该帖')
    }
  } finally {
    adminBusy.value = false
  }
}

// ---- 作者操作：隐藏/恢复/删除自己的帖子 ----
const ownerBusy = ref(false)
async function ownerToggleHide() {
  if (!post.value) return
  ownerBusy.value = true
  try {
    if (isHidden.value) {
      await restorePost(post.value.id)
      post.value.status = 0
      ElMessage.success('帖子已恢复可见')
    } else {
      await hidePost(post.value.id)
      post.value.status = 1
      ElMessage.success('帖子已隐藏（其他人不可见，获赞数保留）')
    }
    clearAllSnaps() // 可见性变了，列表快照过期
  } catch (e) {
    // 拦截器已提示
  } finally {
    ownerBusy.value = false
  }
}

// 跳转到编辑页（路由 /editor?edit={postId}）
function goEdit() {
  if (!post.value) return
  router.push(`/editor?edit=${post.value.id}`)
}

// ---- 删除自己的回帖（仅本人/ADMIN，版主无权） ----
async function deleteOneReply(r) {
  try {
    await ElMessageBox.confirm(
      `确定删除该回复吗？删除后不可恢复，帖子回复数会相应减少。`,
      '删除回复',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch (e) {
    return // 用户取消
  }
  try {
    await deleteReply(r.id)
    ElMessage.success('回复已删除')
    // 9-07：扁平回帖，直接按 id 移除（不再遍历树）
    const idx = replies.value.findIndex((x) => x.id === r.id)
    if (idx !== -1) replies.value.splice(idx, 1)
    // 帖子回复数 -1
    if (post.value && post.value.replyCount > 0) post.value.replyCount -= 1
  } catch (e) {
    // 拦截器已提示
  }
}
// 判断当前用户能否删除某条回帖（自己发的或 ADMIN）
function canDeleteReply(r) {
  if (!userStore.isLoggedIn || !post.value) return false
  if (userStore.isAdmin) return true
  return r.userId === userStore.userInfo?.id
}
async function ownerDelete() {
  if (!post.value) return
  try {
    await ElMessageBox.confirm(
      `确定删除《${post.value.title}》吗？删除后不可恢复，帖子数和获赞数都会相应减少。`,
      '删除帖子',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch (e) {
    return // 用户取消
  }
  ownerBusy.value = true
  try {
    await deletePost(post.value.id)
    ElMessage.success('帖子已删除')
    clearAllSnaps() // 列表缓存里的这条帖子已失效，全部清掉
    router.push('/my?tab=posts')
  } catch (e) {
    // 拦截器已提示
  } finally {
    ownerBusy.value = false
  }
}

onMounted(refresh)

// 关键：在 PostDetail 跳到另一个 PostDetail 时（同路由复用组件），手动刷新
watch(() => route.params.id, (newId, oldId) => {
  if (newId && newId !== oldId) {
    replyTo.value = null
    replyText.value = ''
    refresh()
  }
})
// 同一帖子不同 replyId（通知列表连续点两条回复）也要重新滚动高亮
watch(() => route.query.replyId, () => {
  if (route.params.id && post.value) scrollToReply()
})
</script>

<style scoped>
.detail {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
}
.crumb {
  font-size: 12.5px;
  color: var(--t3);
  margin-bottom: 14px;
}
.crumb .sep {
  margin: 0 7px;
}
.d-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.d-title {
  margin: 0 0 14px;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.4;
  color: var(--t1);
}
.d-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.d-ava {
  background: var(--bg-3);
  font-size: 14px;
  /* 9-07：作者头像 hover 轻微放大 + 高亮光圈 */
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  transform-origin: center;
}
.d-author-link:hover .d-ava {
  transform: scale(1.1);
  box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.35);
}
.d-author {
  font-weight: 700;
  color: var(--t1);
}
.d-badge, .d-level, .r-badge, .r-level {
  font-size: 11.5px !important;
  padding: 0 8px !important;
  height: 20px !important;
  line-height: 19px !important;
  font-weight: 700 !important;
}
.d-level.lv-1 { color: #6b7280; border-color: rgba(107,114,128,0.55); background: rgba(107,114,128,0.12); }
.d-level.lv-2 { color: #cd7f32; border-color: rgba(205,127,50,0.6); background: rgba(205,127,50,0.14); }
.d-level.lv-3 { color: #c0c0c0; border-color: rgba(192,192,192,0.6); background: rgba(192,192,192,0.14); }
.d-level.lv-4 { color: #f6c453; border-color: rgba(246,196,83,0.6); background: rgba(246,196,83,0.14); }
.d-level.lv-5 { color: #c084fc; border-color: rgba(192,132,252,0.6); background: rgba(192,132,252,0.16); }
.r-level.lv-1 { color: #6b7280; border-color: rgba(107,114,128,0.55); background: rgba(107,114,128,0.12); }
.r-level.lv-2 { color: #cd7f32; border-color: rgba(205,127,50,0.6); background: rgba(205,127,50,0.14); }
.r-level.lv-3 { color: #c0c0c0; border-color: rgba(192,192,192,0.6); background: rgba(192,192,192,0.14); }
.r-level.lv-4 { color: #f6c453; border-color: rgba(246,196,83,0.6); background: rgba(246,196,83,0.14); }
.r-level.lv-5 { color: #c084fc; border-color: rgba(192,132,252,0.6); background: rgba(192,132,252,0.16); }
.d-author-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  cursor: pointer;
}
.d-author-link:hover .d-author {
  color: var(--brand);
}
.d-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.d-tag {
  padding: 3px 11px;
  border-radius: 999px;
  background: rgba(124, 92, 255, 0.16);
  color: #c4b5ff;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.15s;
}
.d-tag:hover {
  background: rgba(124, 92, 255, 0.3);
  color: #fff;
}
.d-follow {
  margin-left: 10px;
}
.d-time {
  font-size: 12px;
  color: var(--t3);
}
.d-stats {
  margin-left: auto;
  display: flex;
  gap: 16px;
  font-size: 12.5px;
  color: var(--t2);
}
.d-stats span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.d-preview-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 14px;
  padding: 11px 14px;
  border-radius: 10px;
  background: rgba(245, 108, 108, 0.12);
  border: 1px solid rgba(245, 108, 108, 0.4);
  color: #f89898;
  font-size: 13px;
  line-height: 1.7;
}
.d-preview-banner .d-preview-icon {
  font-size: 18px;
  flex: none;
  margin-top: 1px;
}
.d-preview-banner b {
  color: #ff7878;
  margin-right: 4px;
}
/* 审核 / 驳回提示横幅（作者本人可见） */
.d-review-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 14px;
  padding: 11px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.7;
}
.d-review-banner .d-preview-icon {
  font-size: 18px;
  flex: none;
  margin-top: 1px;
}
.d-review-banner.pending {
  background: rgba(64, 158, 255, 0.12);
  border: 1px solid rgba(64, 158, 255, 0.4);
  color: #79bbff;
}
.d-review-banner.pending b {
  color: #8cc8ff;
}
.d-review-banner.rejected {
  background: rgba(245, 108, 108, 0.12);
  border: 1px solid rgba(245, 108, 108, 0.4);
  color: #f89898;
}
.d-review-banner.rejected b {
  color: #ff7878;
}
.d-review-banner .d-reject-text {
  flex: 1;
}
.d-review-banner .d-reject-btn {
  flex: none;
  align-self: center;
}
.d-body {
  padding: 18px 0;
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--t1);
}
/* 富文本图片尺寸规范：避免大图撑爆帖子详情面板 */
.d-body :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 480px;
  width: auto;
  height: auto;
  margin: 10px 0;
  border-radius: 8px;
  background: var(--bg-3);
  object-fit: contain;
}
.d-body :deep(a) {
  color: var(--brand);
  text-decoration: underline;
}
.d-note {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--t3);
}
.d-actions {
  display: flex;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.d-report {
  margin-left: auto;
  color: var(--t3);
}
.d-report:hover {
  color: var(--danger, #f56c6c);
}
.d-admin {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--brand-soft, rgba(124, 92, 255, 0.1));
  border: 1px solid var(--border);
  border-radius: 12px;
}
.d-owner {
  background: rgba(246, 196, 83, 0.1);
}
.d-owner .d-admin-label {
  color: #f6c453;
}
.d-admin-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--brand, #7c5cff);
  letter-spacing: 1px;
}
.rep-tip {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--t3);
  line-height: 1.6;
}
.replies {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.reply {
  display: flex;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  border-radius: 8px;
  transition: background 0.25s, box-shadow 0.25s;
}
.reply.highlighted {
  background: rgba(124, 92, 255, 0.14);
  box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.45);
  padding-left: 12px;
  padding-right: 12px;
  margin: 0 -12px;
}
.r-ava {
  background: var(--bg-3);
  font-size: 15px;
  flex: none;
}
.r-main {
  flex: 1;
  min-width: 0;
}
.r-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.r-author {
  font-weight: 700;
  color: var(--t1);
}
/* 头像 / / 作者名点击 → 个人主页（透明继承色 + hover 高亮） */
.r-ava-link,
.r-author-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.r-author-link:hover .r-author {
  color: var(--brand);
}
.r-time {
  font-size: 11.5px;
  color: var(--t3);
}
.r-content {
  margin: 6px 0 8px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--t2);
}
/* 9-07：扁平回帖 - 引用前缀样式（replyToName 非空时显示「回复 @昵称：」） */
.r-quote {
  color: var(--t3);
  font-size: 12.5px;
  margin-right: 4px;
}
.r-quote b {
  color: var(--brand);
  font-weight: 600;
}
/* 前缀里被回复者昵称（可点击 → 其个人主页） */
.r-quote-link {
  color: var(--brand);
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  margin: 0 1px;
}
.r-quote-link:hover {
  color: #fff;
  text-decoration: underline;
}
/* 1.2：楼中楼回复弹窗：被回复者预览 + 富文本编辑器 */
.rd-quote {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-left: 3px solid var(--brand);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  max-height: 140px;
  overflow: auto;
}
.rd-quote-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--t3);
  margin-bottom: 6px;
}
.rd-quote-author {
  color: var(--t1);
  font-size: 13px;
  font-weight: 700;
}
.rd-quote-to b {
  color: var(--brand);
  font-weight: 600;
}
.rd-quote-body {
  font-size: 13px;
  color: var(--t2);
  line-height: 1.6;
  word-break: break-word;
}
.rd-body {
  margin-top: 4px;
}
/* 9-07：4399 风格回帖操作栏：点赞 / 回复 / 举报（统一扁平） */
.r-actions {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 12.5px;
  color: var(--t3);
  margin-top: 8px;
}
.r-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
  user-select: none;
}
.r-action:hover {
  color: var(--brand);
}
.r-action-liked {
  color: var(--brand);
}
.r-action-liked:hover {
  color: var(--brand);
}
.r-action-report:hover {
  color: var(--danger, #f56c6c);
}
.r-action-num {
  font-size: 12.5px;
  min-width: 8px;
}
.r-action-label {
  font-size: 12.5px;
}
.r-actions .r-del {
  height: 22px;
  padding: 0 8px;
  font-size: 11.5px;
  margin-left: -10px;
}
/* 9-07：扁平回帖，旧的 .sub / .sub-item / .s-* 样式全部清理（无嵌套结构，不再需要） */
.reply-box {
  margin-top: 18px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
}
.rb-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
/* 2026-09-08：非公开帖（待审核 / 已隐藏）的回帖锁定提示 */
.reply-locked {
  margin-top: 18px;
  padding: 13px 16px;
  background: var(--bg-2);
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--t3);
  font-size: 13.5px;
  text-align: center;
  letter-spacing: 0.2px;
}
.related {
  margin-top: 22px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.rel-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rel-item {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.rel-item:hover .rel-title {
  color: var(--brand);
}
.rel-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--t1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}
.rel-meta {
  flex: none;
  font-size: 11.5px;
  color: var(--t3);
}
/* 9-07：扁平回帖内嵌富文本图片尺寸（避免撑爆回帖卡片） */
.r-content :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 320px;
  width: auto;
  height: auto;
  margin: 8px 0;
  border-radius: 6px;
  background: var(--bg-3);
  object-fit: contain;
}
.r-content :deep(a) {
  color: var(--brand);
  text-decoration: underline;
}

/* ============================================================
   移动端适配（9-10 第二梯队）
   背景：社区帖子详情页此前零断点，手机（375~430px）上表现为——
   ① 标题 + 元信息一行挤不下（头像/昵称/徽章/时间/关注/数据统计全在一行）；
   ② 作者与管理员操作栏按钮溢出；③ 正文内边距偏大、正文图片 480px 限高在窄屏留白多；
   ④ 回帖操作栏（点赞/回复/举报/删除）换行挤压。
   策略：只调「间距 / 字号 / 换行」，不动楼中楼的头像尺寸与 grid 结构
   （9-07 已定稿：主回复 40px、子评论 30px，改动会引发头像错位）。
   ============================================================ */
@media (max-width: 900px) {
  .d-title {
    font-size: 20px;
  }
  .d-meta {
    flex-wrap: wrap;
  }
  /* 统计信息不再靠右顶，改为整行左对齐（窄屏要避免被挤成两三个字换行） */
  .d-stats {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .detail {
    padding: 14px 13px;
    border-radius: 12px;
  }
  .d-title {
    font-size: 18.5px;
    margin-bottom: 10px;
  }
  .d-meta {
    gap: 8px;
    padding-bottom: 12px;
  }
  .d-author-link {
    gap: 6px;
  }
  .d-follow {
    margin-left: 0;
  }
  .d-stats {
    gap: 12px;
    flex-wrap: wrap;
  }
  /* 操作栏：点赞/收藏/举报换行排列，举报不再被 margin-left:auto 推到屏幕外 */
  .d-actions {
    flex-wrap: wrap;
    gap: 8px;
  }
  .d-report {
    margin-left: 0;
  }
  /* 作者 / 管理员操作栏：按钮换行，标签独占一行 */
  .d-admin {
    gap: 8px;
    padding: 10px 12px;
  }
  .d-admin-label {
    width: 100%;
  }
  /* 正文：内边距与字号收紧；图片不设限高（窄屏本来就矮，限高反而留白） */
  .d-body {
    padding: 14px 0;
    font-size: 14px;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .d-body :deep(img) {
    max-height: none;
  }
  /* 长代码块 / 表格横向滚动，不撑破整页 */
  .d-body :deep(pre),
  .d-body :deep(table) {
    overflow-x: auto;
  }
  .d-tags {
    padding-bottom: 12px;
  }
  /* 审核/驳回横幅：按钮换行到文案下方 */
  .d-review-banner {
    flex-wrap: wrap;
  }
  .d-review-banner .d-reject-btn {
    align-self: flex-start;
    margin-left: 28px;
  }
  /* 回帖：缩小卡片间距与操作栏间隔（头像尺寸保持不变） */
  .reply {
    gap: 10px;
  }
  .r-actions {
    gap: 12px;
    flex-wrap: wrap;
  }
  .reply.highlighted {
    margin: 0 -8px;
    padding-left: 8px;
    padding-right: 8px;
  }
  .reply-box {
    padding: 12px;
  }
  .reply-locked {
    font-size: 13px;
    padding: 11px 12px;
  }
  .related {
    padding: 12px;
  }
}

@media (max-width: 420px) {
  .detail {
    padding: 12px 10px;
  }
  .d-title {
    font-size: 17px;
  }
  .d-stats {
    font-size: 12px;
  }
  /* 操作按钮加大点按区域（手指比鼠标粗，默认 small 尺寸偏小） */
  .d-actions :deep(.el-button) {
    padding: 8px 13px;
  }
}
</style>
