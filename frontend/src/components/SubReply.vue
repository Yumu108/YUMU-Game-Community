<template>
  <!-- 9-07 平铺式楼中楼：子评论单行（不缩进、不递归），靠「回复 @昵称」前缀标记被回复对象 -->
  <!-- 9-07 修复头像错位：grid 双列布局（30px 头像列 + 1fr 内容列），router-link 显式块级 + overflow hidden，避免 link 区域被撑大覆盖整行 -->
  <div :id="`sub-reply-${sub.id}`" class="sub-reply" :class="{ 'sub-newest': isNewest, highlighted: highlightId === sub.id }">
    <!-- 头像列：固定 30px，link 严格 22x22 圆形 -->
    <div class="sr-ava-col">
      <router-link :to="`/user/${sub.userId}`" class="sr-ava-link" :title="`@${sub.author} 的主页`">
        <el-avatar :size="22" :src="sub.avatar" class="sr-ava">
          {{ sub.author?.[0] || '游' }}
        </el-avatar>
      </router-link>
    </div>
    <div class="sr-main">
      <div class="sr-line">
        <router-link :to="`/user/${sub.userId}`" class="sr-author-link">
          <span class="sr-author">{{ sub.author }}</span>
        </router-link>
        <el-tag
          v-if="sub.authorBadge"
          :type="sub.authorBadgeColor"
          size="small"
          effect="dark"
          class="sr-badge"
        >{{ badgeText(sub.authorBadge) }}</el-tag>
        <!-- 「回复 @昵称」前缀（点击跳被回复者主页） -->
        <span v-if="sub.replyToName" class="sr-quote">
          回复
          <router-link
            v-if="sub.replyToUserId"
            :to="`/user/${sub.replyToUserId}`"
            class="sr-quote-link"
          >@{{ sub.replyToName }}</router-link>
          <b v-else class="sr-quote-name">@{{ sub.replyToName }}</b>
        </span>
        <span class="sr-sep">：</span>
        <span class="sr-content" v-html="renderRichText(sub.content)"></span>
        <span class="sr-time num">{{ sub.createdAt }}</span>
      </div>
      <!-- 子评论操作栏 -->
      <div class="r-actions">
        <span
          class="r-action"
          :class="{ 'r-action-liked': likedSet.has(sub.id) }"
          :title="likedSet.has(sub.id) ? '取消点赞' : '点赞'"
          @click="emitLike(sub)"
        >
          <ThumbUp :size="12" :active="likedSet.has(sub.id)" />
          <span class="r-action-num">{{ sub.likeCount || '' }}</span>
          <span v-if="!likedSet.has(sub.id) && !sub.likeCount" class="r-action-label">赞</span>
        </span>
        <span class="r-action" @click="emitReply(sub)">回复</span>
        <span
          v-if="canReport"
          class="r-action r-action-report"
          @click="emitReport(sub)"
        >举报</span>
        <el-button
          v-if="canDelete"
          size="small"
          type="danger"
          plain
          class="r-del"
          @click="emitDelete(sub)"
        >删除</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import ThumbUp from './ThumbUp.vue'
import { renderRichText } from '@/utils/richtext'

defineProps({
  sub: { type: Object, required: true },
  canDelete: { type: Boolean, default: false },
  canReport: { type: Boolean, default: false },
  likedSet: { type: Set, default: () => new Set() },
  isNewest: { type: Boolean, default: false },
  // 9-07：通知点击跳楼层/楼中楼的高亮（PostDetail.query.replyId 透传，sub.id === highlightId 时高亮）
  highlightId: { type: Number, default: null }
})
const emit = defineEmits(['like', 'reply', 'report', 'delete'])

function emitLike(r) { emit('like', r) }
function emitReply(r) { emit('reply', r) }
function emitReport(r) { emit('report', r) }
function emitDelete(r) { emit('delete', r) }

function badgeText(code) {
  return { ADMIN: '管理员', MODERATOR: '版主', SUB_MODERATOR: '子板主' }[code] || ''
}
</script>

<style scoped>
/* 9-07 修复：grid 严格双列布局（30px 头像列 + 1fr 内容列），避免头像 link 被撑大覆盖整行 */
.sub-reply {
  display: grid;
  grid-template-columns: 30px 1fr;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--border);
  /* 9-07：高亮过渡（通知跳楼层/楼中楼时背景色淡入淡出） */
  transition: background-color 0.4s ease, box-shadow 0.4s ease;
}
.sub-reply:last-child {
  border-bottom: 0;
}
/* 9-07：通知跳到子评论高亮（与 MainReply 同款紫色光圈，4s 淡出） */
.sub-reply.highlighted {
  background: rgba(124, 92, 255, 0.18);
  box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.5);
  border-radius: 6px;
  padding-left: 6px;
  padding-right: 6px;
  margin: 0 -6px;
}
.sr-ava-col {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  flex: none;
}
/* 关键：link 区域严格 22x22 圆形，overflow hidden 防止 inline 子元素（图片/字符）撑大 link */
.sr-ava-link {
  display: block;
  width: 22px;
  height: 22px;
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
.sr-ava-link:hover {
  transform: scale(1.18);
  box-shadow: 0 0 0 2.5px rgba(124, 92, 255, 0.35);
}
.sr-ava-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2.5px rgba(124, 92, 255, 0.5);
}
.sr-ava {
  background: var(--bg-3);
  /* 强制：即使 el-avatar 内部有 <img> 也要刚好 22x22 */
  width: 22px !important;
  height: 22px !important;
  line-height: 22px !important;
}
.sr-ava :deep(img) {
  width: 22px;
  height: 22px;
  object-fit: cover;
}
.sr-author-link {
  display: inline;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
.sr-main {
  min-width: 0; /* 关键：grid/flex 子项允许内容收缩，避免撑爆父容器 */
  font-size: 13px;
  line-height: 1.7;
  color: var(--t2);
}
.sr-line {
  word-break: break-word;
}
.sr-author {
  color: var(--brand);
  font-weight: 600;
  margin-right: 4px;
}
.sr-author-link:hover .sr-author {
  color: #fff;
}
.sr-badge {
  font-size: 10.5px !important;
  padding: 0 6px !important;
  height: 18px !important;
  line-height: 17px !important;
  margin-right: 4px;
}
.sr-quote {
  color: var(--t3);
  font-size: 12.5px;
  margin-right: 2px;
}
.sr-quote-link {
  color: var(--brand);
  font-weight: 600;
  text-decoration: none;
  margin: 0 1px;
}
.sr-quote-link:hover {
  color: #fff;
  text-decoration: underline;
}
.sr-quote-name {
  color: var(--brand);
  font-weight: 600;
}
.sr-sep {
  color: var(--t2);
  margin-right: 4px;
}
.sr-content {
  /* renderRichText 输出含 inline 元素 */
}
.sr-content :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 240px;
  width: auto;
  height: auto;
  margin: 6px 0;
  border-radius: 6px;
  background: var(--bg-3);
  object-fit: contain;
  /* 关键：图片不能被上层 router-link 覆盖点击区 */
  position: relative;
  z-index: 0;
  pointer-events: auto;
}
.sr-content :deep(a) {
  color: var(--brand);
  text-decoration: underline;
  position: relative;
  z-index: 1;
}
.sr-time {
  font-size: 11px;
  color: var(--t3);
  margin-left: 6px;
}
.r-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11.5px;
  color: var(--t3);
  margin-top: 4px;
  position: relative;
  z-index: 1;
}
.r-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  padding: 1px 3px;
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
  font-size: 11.5px;
  min-width: 6px;
}
.r-action-label {
  font-size: 11.5px;
}
.r-del {
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  margin-left: -6px;
}
</style>