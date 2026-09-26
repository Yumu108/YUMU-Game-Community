<template>
  <view class="pc" @click="onTap">
    <view class="pc__body">
      <view class="pc__head">
        <!--
          官方标识（2026-09-21）—— 放在最前：它是**来源身份**，比「置顶/精华」这类
          内容属性更该被第一眼看到。由发帖账号 uid 判定，不依赖昵称（昵称可改）。
        -->
        <text v-if="isOfficial" class="pc__badge pc__badge--official">官方</text>
        <!--
          「置顶」角标 —— **只在游戏详情页显示**（2026-09-21 用户口径：
          「置顶改成只在游戏详情页内优先」）。
          官方帖的 `is_top` 是**游戏内**语义：官方公告在它所属的那款游戏里置顶。
          聚合列表（攻略页/资讯页）里它既不置顶、排序也不吃它
          （见 `guideQuery.makeCmpLatest`），此时再挂「置顶」角标就与它所在的位置打架
          —— 用户会看到一个标着「置顶」却排在列表中间的卡片。所以按 `inGame` 收起来。
          普通用户/版主的置顶**不受影响**：它们在聚合列表里确实排在最前，角标照常显示。
        -->
        <text v-if="showTop" class="pc__badge pc__badge--top">置顶</text>
        <text v-if="showEssence" class="pc__badge pc__badge--best">精华</text>
        <text class="pc__title" :class="{ 'pc__title--clamp': clamp }">{{ post.title }}</text>
      </view>

      <text v-if="summary" class="pc__summary" :class="{ 'pc__summary--clamp': clamp }">{{ summary }}</text>

      <view class="pc__meta">
        <!--
          平台角标 —— 定位改为「多平台攻略聚合」后，平台是**第一眼要看到的分类维度**，
          所以放在最前面。只有端内索引过来的数据带 `platform`（服务端列表接口不下发），
          没有时整块隐藏，不显示空标签。
        -->
        <text v-if="post.platform" class="pc__plat" :class="platClass">{{ platLabel }}</text>
        <text v-if="post.gameName" class="mp-tag mp-tag--purple">{{ post.gameName }}</text>
        <text v-else-if="post.boardName" class="pc__board">{{ post.boardName }}</text>
        <text class="pc__dot">·</text>
        <text class="pc__time">{{ timeText }}</text>
        <view class="pc__spacer" />
        <!--
          互动指标从「👍 赞 / 💬 回复」改为「👍 赞 / 👁 浏览」：
          定位弱化讨论后，「回复数」不再是读者关心的信号，浏览量才反映内容被阅读的程度。
        -->
        <text class="pc__stat">👍 {{ likeText }}</text>
        <text class="pc__stat">👁 {{ viewText }}</text>
      </view>
    </view>

    <!--
      封面：列表接口的每条帖子都带 `cover`（种子内容覆盖率约 7 成），
      没有封面时退到所属游戏的 `gameCover`，画面不至于整片纯文字。
      ⚠️ 加载失败必须整个移除，不能留一个空框 —— 宁可没有缩略图，也不要破图。

      🚨 无障碍：`alt` 在**小程序端**是 `<image>` 的原生属性，但 **H5 端会被直接丢弃**
         —— 实测（tests/probe-alt.cjs）线上 12 张内容封面的真实 `<img>` **一个 alt 属性都没有**，
         写了等于白写。所以两端各给一份：`alt` 留给小程序，`role` + `aria-label` 给 H5 读屏。
         只写 `alt` 不行，只写 `aria-label` 也不行 —— 这不是冗余，是两个运行时的差异。
    -->
    <image
      v-if="thumb"
      class="pc__thumb"
      :src="thumb"
      mode="aspectFill"
      :lazy-load="true"
      :alt="post.title || '帖子封面'"
      role="img"
      :aria-label="post.title || '帖子封面'"
      @error="onThumbError"
    />
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { formatTime, shortNumber, resolveImage, platformLabel } from '../utils/format'
import { summaryOf } from '../utils/content'
import { OFFICIAL_UID } from '../api/config'

const props = defineProps({
  post: { type: Object, required: true },
  clamp: { type: Boolean, default: true },
  /**
   * 卡片是否处在**某一款游戏的详情页**里。
   * 只影响「置顶」角标的显隐：官方帖的置顶是**游戏内**语义
   * （官方公告在它所属的那款游戏里置顶），聚合列表里它并不置顶。
   */
  inGame: { type: Boolean, default: false }
})
const emit = defineEmits(['tap'])

/**
 * 是否官方帖 —— 按**发帖账号 uid** 判定，不按昵称/角色。
 * `Number()` 归一化：索引经存储往返后 userId 可能是字符串，直接全等会漏判。
 */
const isOfficial = computed(() => Number(props.post.userId) === OFFICIAL_UID)

/**
 * 角标显隐 —— 🚨 必须 `Number(...) === 1` 归一化，不能直接写 `v-if="post.isTop"`：
 * 后端是 `tinyint 0/1`，索引经 localStorage 往返后可能落成字符串 `'0'`，
 * 而 **`'0'` 在 JS 里是真值** ⇒ 没置顶的帖子也会被挂上「置顶」角标（静默错显）。
 */
const showTop = computed(() => Number(props.post.isTop) === 1 && (!isOfficial.value || props.inGame))
const showEssence = computed(() => Number(props.post.isEssence) === 1)

const summary = computed(() => summaryOf(props.post, 52))
const timeText = computed(() => formatTime(props.post.createdAt))
const likeText = computed(() => shortNumber(props.post.likeCount))
const viewText = computed(() => shortNumber(props.post.viewCount))

/** 平台角标配色 —— 四档各一色，扫一眼就能区分（取 App.vue 的主题令牌） */
const PLAT_CLASS = {
  '多平台': 'pc__plat--multi',
  PC: 'pc__plat--pc',
  '主机': 'pc__plat--console',
  '手机': 'pc__plat--mobile'
}
const platClass = computed(() => PLAT_CLASS[props.post.platform] || '')
const platLabel = computed(() => platformLabel(props.post.platform))

/** 封面优先级：帖子自己的 cover → 所属游戏封面 */
const thumb = ref('')
watch(
  () => [props.post && props.post.cover, props.post && props.post.gameCover],
  ([c, gc]) => {
    thumb.value = resolveImage(c || gc || '')
  },
  { immediate: true }
)
function onThumbError() {
  thumb.value = ''
}

function onTap() {
  emit('tap', props.post)
  uni.navigateTo({ url: `/pages/post/detail?id=${props.post.id}` })
}
</script>

<style scoped>
.pc {
  display: flex;
  align-items: flex-start;
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-radius: 22rpx;
  padding: 22rpx;
  margin-bottom: 18rpx;
}
.pc__body {
  flex: 1;
  min-width: 0;
}
.pc__thumb {
  flex: none;
  width: 200rpx;
  height: 150rpx;
  margin-left: 20rpx;
  border-radius: 14rpx;
  background: #231f31;
}
.pc__head {
  display: flex;
  align-items: flex-start;
}
.pc__badge {
  flex: none;
  font-size: 20rpx;
  line-height: 1.7;
  padding: 0 10rpx;
  border-radius: 6rpx;
  margin-right: 10rpx;
  /* 与两行标题的首行视觉对齐 */
  margin-top: 6rpx;
}
.pc__badge--top {
  background: rgba(240, 159, 39, 0.16);
  color: #f0b45f;
}
.pc__badge--best {
  background: rgba(124, 92, 255, 0.22);
  color: #cbbdff;
}
/*
  官方标识 —— 用青色（与「主机」平台角标同色系）而不是紫色：
  紫色已被「精华」占用，再用会分不清哪个是官方、哪个是精华。
  实底 + 深色字，在深色卡片上是全卡最"确定"的一块，符合"官方"该有的分量。
*/
.pc__badge--official {
  background: rgba(25, 227, 194, 0.9);
  color: #06322b;
  font-weight: 600;
}
.pc__title {
  font-size: 30rpx;
  font-weight: 600;
  color: #e9e7f2;
  flex: 1;
  min-width: 0;
  line-height: 1.4;
}
/* 两行截断：长标题（实测有 30+ 字的）单行读不完，列表里全是「……xxx…」 */
.pc__title--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pc__summary {
  display: block;
  margin-top: 12rpx;
  font-size: 25rpx;
  color: #a49eb6;
  line-height: 1.6;
}
.pc__summary--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pc__meta {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  /* 元信息行高度必须恒定：长游戏名（「崩坏：星穹铁道」）一旦折行，
     右侧的赞/回复数字会被 align-items:center 拽到第二行，整行看起来错位 */
  overflow: hidden;
  white-space: nowrap;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #a49eb6;
}
/**
 * 🚨 必须逐个直接命中：uni-app 的 `<text>` 在 H5 渲染成 `uni-text`，
 *   其基础样式带了 `white-space: pre-line` —— **会覆盖从父级继承的 nowrap**，
 *   只写父级 nowrap 是没用的，实测「资讯速递」照样被拆成两行。
 *
 * ⚠️ 2026-09-25：通配符 `*` **只有 H5 能用**。微信 WXSS 编译器（wcsc）不支持 `*`，
 *   会直接报 `error at token '*'` 导致整个小程序**编译失败**（H5 却完全正常）。
 *   而小程序端 `<text>` 是原生标签、根本没有 `pre-line` 这个问题，
 *   所以本规则用条件编译**只保留给 H5**。
 *   🚨 千万别去掉 #ifdef —— 去掉后小程序端就编译不过了。
 */
/* #ifdef H5 */
.pc__meta > * {
  white-space: nowrap;
}
/* #endif */
.pc__meta .mp-tag {
  flex: none;
  max-width: 160rpx;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__board {
  flex: none;
  max-width: 200rpx;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__dot {
  margin: 0 8rpx;
}
/*
  平台角标 —— 「多平台攻略聚合」定位下，平台是第一眼要看到的分类维度，
  四档各配一色（PC 紫 / 主机 青 / 手游 橙 / 多平台 蓝），扫一眼即可区分。
  用「浅色文字 + 低透明度同色底」而不是纯色块，避免在深色卡片上抢标题的风头。
*/
.pc__plat {
  flex: none;
  font-size: 19rpx;
  line-height: 1.7;
  padding: 0 10rpx;
  border-radius: 6rpx;
  margin-right: 10rpx;
}
.pc__plat--pc {
  background: rgba(124, 92, 255, 0.2);
  color: #cbbdff;
}
.pc__plat--console {
  background: rgba(25, 227, 194, 0.16);
  color: #6fe3d0;
}
.pc__plat--mobile {
  background: rgba(240, 159, 39, 0.18);
  color: #f0b45f;
}
.pc__plat--multi {
  background: rgba(143, 189, 240, 0.18);
  color: #a9cdf5;
}
.pc__spacer {
  flex: 1;
}
.pc__stat {
  flex: none;
  margin-left: 12rpx;
}
</style>

