<template>
  <!-- 9-07 楼中楼（平铺式）：主回复（顶级）。子评论挂在 children，平铺展示。 -->
  <!-- 9-07 修复头像 link 错位：grid 双列布局（40px 头像列 + 1fr 内容列），link 显式 34x34 + overflow hidden -->
  <div :id="`reply-${reply.id}`" class="main-reply" :class="{ highlighted: highlightId === reply.id }">
    <!-- 头像列：固定 40px，link 严格 34x34 圆形 -->
    <div class="mr-ava-col">
      <router-link :to="`/user/${reply.userId}`" class="mr-ava-link" :title="`@${reply.author} 的主页`">
        <el-avatar :size="34" :src="reply.avatar" class="mr-ava">
          {{ reply.author?.[0] || '游' }}
        </el-avatar>
      </router-link>
    </div>
    <div class="mr-main">
      <!-- 头部 -->
      <div class="mr-head">
        <router-link :to="`/user/${reply.userId}`" class="mr-author-link">
          <span class="mr-author">{{ reply.author }}</span>
        </router-link>
        <el-tag
          v-if="reply.authorBadge"
          :type="reply.authorBadgeColor"
          size="small"
          effect="dark"
          :title="badgeTitle(reply.authorBadge, reply.authorModeratorGameNames)"
          class="mr-badge"
        >{{ badgeText(reply.authorBadge, reply.authorModeratorGameNames) }}</el-tag>
        <el-tag
          size="small"
          effect="plain"
          class="mr-level"
          :class="`lv-${reply.authorLevel || 1}`"
        >{{ cleanLevelTitle(reply.authorLevel, reply.authorLevelTitle) }}</el-tag>
        <span class="mr-time num">{{ reply.createdAt }}</span>
      </div>
      <!-- 内容 -->
      <p class="mr-content" v-html="renderRichText(reply.content)"></p>
      <!-- 操作栏 -->
      <div class="r-actions">
        <span
          class="r-action"
          :class="{ 'r-action-liked': likedSet.has(reply.id) }"
          :title="likedSet.has(reply.id) ? '取消点赞' : '点赞'"
          @click="emitLike(reply)"
        >
          <ThumbUp :size="13" :active="likedSet.has(reply.id)" />
          <span class="r-action-num">{{ reply.likeCount || '' }}</span>
          <span v-if="!likedSet.has(reply.id) && !reply.likeCount" class="r-action-label">点赞</span>
        </span>
        <span class="r-action" @click="emitReply(reply)">回复</span>
        <span
          v-if="canReport"
          class="r-action r-action-report"
          @click="emitReport(reply)"
        >举报</span>
        <el-button
          v-if="canDelete"
          size="small"
          type="danger"
          plain
          class="r-del"
          @click="emitDelete(reply)"
        >删除</el-button>
      </div>

      <!-- 子评论区（平铺、不缩进；>3 条默认折叠，只显示最新 3） -->
      <div v-if="reply.children?.length" class="mr-subzone">
        <SubReply
          v-for="(c, idx) in shownChildren"
          :key="c.id"
          :sub="c"
          :can-delete="canDelete"
          :can-report="canReport"
          :liked-set="likedSet"
          :is-newest="idx === 0"
          :highlight-id="highlightId"
          @like="emitLike"
          @reply="emitReply"
          @report="emitReport"
          @delete="emitDelete"
        />
        <div
          v-if="reply.children.length > FOLD_THRESHOLD"
          class="mr-fold-toggle"
          @click="expanded = !expanded"
        >
          {{ expanded
            ? '收起'
            : `展开剩余 ${reply.children.length - FOLD_THRESHOLD} 条回复` }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import ThumbUp from './ThumbUp.vue'
import SubReply from './SubReply.vue'
import { renderRichText } from '@/utils/richtext'

const FOLD_THRESHOLD = 3 // 子评论 >3 默认折叠

const props = defineProps({
  reply: { type: Object, required: true },
  canDelete: { type: Boolean, default: false },
  canReport: { type: Boolean, default: false },
  likedSet: { type: Set, default: () => new Set() },
  highlightId: { type: Number, default: null }
})
const emit = defineEmits(['like', 'reply', 'report', 'delete'])

// 9-07 平铺式楼中楼：按时间倒序排子评论，最新在前
const sortedChildren = computed(() => {
  const arr = [...(props.reply.children || [])]
  arr.sort((a, b) => (a.id > b.id ? -1 : 1)) // 用 id 倒序（与 createdAt 同步）
  return arr
})
const expanded = ref(false)
const shownChildren = computed(() => {
  if (expanded.value || sortedChildren.value.length <= FOLD_THRESHOLD) {
    return sortedChildren.value
  }
  return sortedChildren.value.slice(0, FOLD_THRESHOLD)
})

function emitLike(r) { emit('like', r) }
function emitReply(r) { emit('reply', r) }
function emitReport(r) { emit('report', r) }
function emitDelete(r) { emit('delete', r) }

const LEVEL_TITLES_PLAIN = {
  1: '初出茅庐', 2: '活跃玩家', 3: '资深玩家', 4: '社区精英', 5: '传说玩家'
}
function cleanLevelTitle(level, fallback) {
  const n = Number(level)
  return LEVEL_TITLES_PLAIN[n] || (fallback ? fallback.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, '').trim() : '') || '初出茅庐'
}
function badgeText(code, gameNames) {
  const base = { ADMIN: '管理员', MODERATOR: '版主', SUB_MODERATOR: '子板主' }[code] || ''
  if (code === 'MODERATOR' && Array.isArray(gameNames) && gameNames.length > 0) {
    const extra = gameNames.length - 1
    return `${base} · ${gameNames[0]}${extra > 0 ? ` (+${extra})` : ''}`
  }
  return base
}
function badgeTitle(code, gameNames) {
  if (code !== 'MODERATOR') return ''
  if (!Array.isArray(gameNames) || gameNames.length === 0) return '当前账号尚未分配负责游戏'
  if (gameNames.length === 1) return `负责游戏：${gameNames[0]}`
  return `负责游戏（${gameNames.length} 个）：${gameNames.join('、')}`
}
</script>

<style scoped>
/* 9-07 修复：grid 双列布局（40px 头像列 + 1fr 内容列），避免头像 link 被撑大覆盖整行 */
.main-reply {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  transition: background 0.25s;
}
.main-reply:last-child {
  border-bottom: 0;
}
.main-reply.highlighted {
  background: rgba(124, 92, 255, 0.14);
  box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.45);
  border-radius: 8px;
  padding-left: 10px;
  padding-right: 10px;
  margin: 0 -10px;
}
.mr-ava-col {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  flex: none;
}
/* 关键：link 区域严格 34x34 圆形，overflow hidden 防止 inline 子元素撑大 link */
.mr-ava-link {
  display: block;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  flex: none;
  line-height: 0;
  /* 9-07：hover 轻微放大 + 高亮光圈 */
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  transform-origin: center;
}
.mr-ava-link:hover {
  transform: scale(1.12);
  box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.35);
}
.mr-ava-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.5);
}
.mr-ava {
  background: var(--bg-3);
  /* 强制：即使 el-avatar 内部有 <img> 也要刚好 34x34 */
  width: 34px !important;
  height: 34px !important;
}
.mr-ava :deep(img) {
  width: 34px;
  height: 34px;
  object-fit: cover;
}
.mr-author-link {
  display: inline;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.mr-main {
  min-width: 0; /* 关键：grid/flex 子项允许内容收缩，避免撑爆父容器 */
  font-size: 14px;
  line-height: 1.7;
  color: var(--t2);
}
.mr-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.mr-author {
  font-weight: 700;
  color: var(--t1);
  font-size: 14px;
}
.mr-author-link:hover .mr-author {
  color: var(--brand);
}
.mr-badge,
.mr-level {
  font-size: 11.5px !important;
  padding: 0 8px !important;
  height: 20px !important;
  line-height: 19px !important;
  font-weight: 700 !important;
}
.mr-level.lv-1 { color: #6b7280; border-color: rgba(107,114,128,0.55); background: rgba(107,114,128,0.12); }
.mr-level.lv-2 { color: #cd7f32; border-color: rgba(205,127,50,0.6); background: rgba(205,127,50,0.14); }
.mr-level.lv-3 { color: #c0c0c0; border-color: rgba(192,192,192,0.6); background: rgba(192,192,192,0.14); }
.mr-level.lv-4 { color: #f6c453; border-color: rgba(246,196,83,0.6); background: rgba(246,196,83,0.14); }
.mr-level.lv-5 { color: #c084fc; border-color: rgba(192,132,252,0.6); background: rgba(192,132,252,0.16); }
.mr-time {
  font-size: 11.5px;
  color: var(--t3);
}
.mr-content {
  margin: 6px 0 8px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--t2);
  word-break: break-word;
}
.mr-content :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 320px;
  width: auto;
  height: auto;
  margin: 8px 0;
  border-radius: 6px;
  background: var(--bg-3);
  object-fit: contain;
  position: relative;
  z-index: 0;
  pointer-events: auto;
}
.mr-content :deep(a) {
  color: var(--brand);
  text-decoration: underline;
  position: relative;
  z-index: 1;
}
/* 4399 风格操作栏 */
.r-actions {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 12.5px;
  color: var(--t3);
  margin-top: 4px;
  position: relative;
  z-index: 1;
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
.r-del {
  height: 22px;
  padding: 0 8px;
  font-size: 11.5px;
  margin-left: -10px;
}
/* 子评论区（平铺、不缩进；浅色背景区分；4399 风格） */
.mr-subzone {
  margin-top: 10px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 12px;
  position: relative;
  z-index: 1;
}
.mr-fold-toggle {
  margin: 4px 0;
  font-size: 12px;
  color: var(--brand);
  cursor: pointer;
  user-select: none;
}
.mr-fold-toggle:hover {
  text-decoration: underline;
}
</style>