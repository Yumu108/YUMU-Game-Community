<template>
  <article class="post" @click="goDetail">
    <div class="p-main">
      <div class="p-head">
        <el-avatar :size="26" :src="post.avatar" class="p-ava" @click.stop="goUser(post.userId)">{{ post.author?.[0] || '游' }}</el-avatar>
        <span class="p-author" @click.stop="goUser(post.userId)">{{ post.author }}</span>
        <el-tag
          v-if="post.authorBadge"
          :type="post.authorBadgeColor"
          size="small"
          effect="dark"
          :title="badgeTitle(post.authorBadge, post.authorModeratorGameNames)"
          class="p-badge"
        >{{ badgeText(post.authorBadge, post.authorModeratorGameNames) }}</el-tag>
        <el-tag
          size="small"
          effect="plain"
          class="p-level"
          :class="`lv-${post.authorLevel || 1}`"
        >{{ cleanLevel(post.authorLevel, post.authorLevelTitle) }}</el-tag>
        <span class="p-sep">·</span>
        <span class="p-board">{{ post.boardName }}</span>
        <span v-if="post.gameId" class="p-game" @click.stop="goGame(post.gameId)">
          <img v-if="post.gameCover" :src="thumbUrl(post.gameCover)" class="p-game-cover" alt="" loading="lazy" decoding="async" @error="fallbackToOriginal" />
          <span v-else class="p-game-emoji">🎮</span>{{ post.gameName }}
        </span>
        <span class="p-time num">{{ post.createdAt }}</span>
      </div>

      <h3 class="p-title">
        <StatusBadge :is-top="post.isTop" :is-essence="post.isEssence" :status="post.status" :reject-reason="post.rejectReason" :resubmit-at="post.resubmitAt" />
        <span class="p-text">{{ post.title }}</span>
      </h3>

      <p class="p-excerpt">{{ post.excerpt }}</p>

      <div class="p-foot">
        <div class="p-meta-left">
          <BoardTag :text="post.boardTag" />
          <span
            v-for="t in (post.tags || [])"
            :key="t.id"
            class="p-tag"
            @click.stop="goTag(t.id)"
          >#{{ t.name }}</span>
        </div>
        <div class="p-stats">
          <span class="stat"><el-icon><ChatDotRound /></el-icon>{{ post.replyCount }}</span>
          <span class="stat"><ThumbUp :size="15" />{{ post.likeCount }}</span>
          <span class="stat"><el-icon><View /></el-icon>{{ post.viewCount }}</span>
        </div>
      </div>
    </div>

    <div class="p-cover">
      <img v-if="post.cover" :src="thumbUrl(post.cover)" alt="cover" loading="lazy" decoding="async" @error="fallbackToOriginal" />
      <span v-else>{{ post.coverEmoji }}</span>
    </div>
  </article>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { thumbUrl, fallbackToOriginal } from '@/utils/img'
import StatusBadge from './StatusBadge.vue'
import BoardTag from './BoardTag.vue'
import ThumbUp from './ThumbUp.vue'

const props = defineProps({
  post: { type: Object, required: true }
})
const router = useRouter()

function goDetail() {
  router.push(`/post/${props.post.id}`)
}
function goUser(id) {
  if (id) router.push(`/user/${id}`)
}
function goTag(id) {
  router.push(`/tag/${id}`)
}
function goGame(id) {
  router.push(`/game/${id}`)
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
// 去除 level 文字里的 emoji，避免在某些字体里渲染为方框
const LEVEL_TITLES_PLAIN = { 1: '初出茅庐', 2: '活跃玩家', 3: '资深玩家', 4: '社区精英', 5: '传说玩家' }
function cleanLevel(level, fallback) {
  const n = Number(level)
  if (LEVEL_TITLES_PLAIN[n]) return LEVEL_TITLES_PLAIN[n]
  return (fallback || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, '').trim() || '初出茅庐'
}
</script>

<style scoped>
.post {
  display: flex;
  gap: 14px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s, background 0.15s;
}
.post:hover {
  border-color: rgba(124, 92, 255, 0.5);
  background: var(--bg-3);
  transform: translateY(-1px);
}
.p-main {
  flex: 1;
  min-width: 0;
}
.p-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--t3);
  margin-bottom: 7px;
}
.p-ava {
  background: var(--bg-3);
  font-size: 13px;
  cursor: pointer;
}
.p-author {
  color: var(--t2);
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s;
}
.p-author:hover {
  color: var(--brand);
}
.p-badge {
  margin-left: 0;
  font-size: 10.5px !important;
  padding: 0 6px !important;
  height: 18px !important;
  line-height: 17px !important;
}
.p-level {
  margin-left: 0;
  font-size: 10.5px !important;
  padding: 0 6px !important;
  height: 18px !important;
  line-height: 17px !important;
}
.p-level.lv-1 { color: #9ca3af; border-color: rgba(156,163,175,0.4); background: rgba(156,163,175,0.08); }
.p-level.lv-2 { color: #cd7f32; border-color: rgba(205,127,50,0.5); background: rgba(205,127,50,0.1); }
.p-level.lv-3 { color: #c0c0c0; border-color: rgba(192,192,192,0.5); background: rgba(192,192,192,0.1); }
.p-level.lv-4 { color: #f6c453; border-color: rgba(246,196,83,0.5); background: rgba(246,196,83,0.1); }
.p-level.lv-5 { color: #c084fc; border-color: rgba(192,132,252,0.5); background: rgba(192,132,252,0.12); }
.p-sep {
  color: var(--t3);
}
.p-board {
  color: var(--brand);
}
.p-game {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #5b8def;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s;
}
.p-game:hover {
  color: #86acff;
  text-decoration: underline;
}
.p-game-cover {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: cover;
}
.p-game-emoji {
  font-size: 13px;
}
.p-time {
  margin-left: auto;
  font-size: 11.5px;
}
.p-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 7px;
  font-size: 15.5px;
  font-weight: 700;
  color: var(--t1);
  line-height: 1.4;
}
.p-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.post:hover .p-text {
  color: #fff;
}
.p-excerpt {
  margin: 0 0 11px;
  font-size: 13px;
  color: var(--t2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.55;
}
.p-foot {
  display: flex;
  align-items: center;
  gap: 12px;
}
.p-meta-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.p-tag {
  padding: 1px 9px;
  border-radius: 999px;
  background: rgba(124, 92, 255, 0.16);
  color: #c4b5ff;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.p-tag:hover {
  background: rgba(124, 92, 255, 0.3);
  color: #fff;
}
.p-stats {
  margin-left: auto;
  display: flex;
  gap: 14px;
  color: var(--t3);
  font-size: 12.5px;
  flex: none;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.p-cover {
  flex: none;
  width: 86px;
  height: 64px;
  border-radius: 10px;
  background: linear-gradient(135deg, #2a2350, #16303a);
  display: grid;
  place-items: center;
  font-size: 30px;
  border: 1px solid var(--border);
  overflow: hidden;
}
.p-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
