<template>
  <view class="ai">
    <!-- 有对话时才出现（欢迎态不需要「新建」） -->
    <view v-if="messages.length" class="reset" @click="newChat">新对话</view>

    <scroll-view class="ai__scroll" scroll-y :scroll-top="scrollTop">
      <!-- 欢迎态：说清这是什么 + 给几个能直接点的问法 -->
      <view v-if="!messages.length" class="intro">
        <view class="intro__badge"><text class="intro__badge-txt">AI</text></view>
        <text class="intro__title">YUMU 智能助手</text>
        <text class="intro__sub">
          问我社区玩法、游戏攻略或社区实时动态。
        </text>
        <view class="intro__chips">
          <view v-for="q in QUICK" :key="q" class="chip" @click="send(q)">
            <text class="chip__txt">{{ q }}</text>
          </view>
        </view>
        <text class="intro__note">
          回答由大模型实时生成，可能不准确，请以社区内容为准。
        </text>
      </view>

      <view v-for="(m, i) in messages" :key="i" class="row" :class="m.role">
        <view class="bubble" :class="m.role">
          <text v-if="m.role === 'user'" class="bubble__plain">{{ m.content }}</text>
          <!--
            🚨 助手侧必须用 rich-text：小程序**不支持 v-html**（该指令会被编译器丢弃），
               而富文本只有这一个渲染入口。nodes 是 utils/mdLite.js 产出的内联样式 HTML。
          -->
          <rich-text v-else-if="m.html" :nodes="m.html"></rich-text>
          <text v-else class="bubble__wait">正在思考…</text>
        </view>
      </view>

      <view class="tail"></view>
    </scroll-view>

    <!-- 错误条：限频 / 网络异常等都要说出来，不能只是「没反应」 -->
    <view v-if="errorText" class="err" @click="errorText = ''">
      <text class="err__txt">⚠️ {{ errorText }}（点此关闭）</text>
    </view>

    <view class="composer">
      <textarea
        v-model="input"
        class="composer__input"
        :disabled="sending"
        auto-height
        :maxlength="500"
        :adjust-position="true"
        placeholder="问我社区玩法、游戏攻略或实时动态"
        placeholder-class="composer__ph"
      />
      <view class="composer__send" :class="{ 'composer__send--off': !canSend }" @click="send()">
        <text class="composer__send-txt">{{ sending ? '回答中' : '发送' }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * 智能助手页 —— 复用后端现成的 `POST /api/ai/chat`（SSE 流式），**无后端改动**。
 *
 * 与主站 `frontend/src/components/AiAssistant.vue` 是同一套协议的另一端实现：
 * 主站是右下角悬浮面板（H5 DOM），本端是独立页面（小程序没有悬浮球习惯），
 * 但事件格式、会话续接、快捷问法保持一致，改协议时两边一起改。
 *
 * 🚨 三个端差异必须在写代码时就避开（都是「构建不报错、运行不对」的静默错）：
 *   ① 富文本：主站用 `v-html`，**小程序不支持** ⇒ 改用 `<rich-text :nodes>`；
 *   ② 流式接收：H5 用 `fetch` 流，小程序用 `wx.request({enableChunked})`，
 *      细节封装在 `api/ai.js` 里，本页只关心 onDelta/onError；
 *   ③ 请求前缀：H5 是相对路径 `/api`、小程序是绝对地址，统一由 `api/config.js` 给。
 */
import { ref, computed, nextTick } from 'vue'
import { onUnload } from '@dcloudio/uni-app'
import { streamAiChat } from '../../api/ai'
import { mdToHtml } from '../../utils/mdLite'

/** 快捷问法（与主站保持同一批，便于对照演示） */
const QUICK = [
  '社区怎么发帖？',
  '今天有什么热门帖子？',
  '推荐几个热门游戏',
  '怎么成为版主？'
]

const input = ref('')
const sending = ref(false)
const messages = ref([])
const convId = ref('')
const errorText = ref('')

/** 滚动：scroll-view 的 scroll-top 只在**值变化**时生效，所以用一个只增不减的值顶到底部 */
const scrollTop = ref(0)
let scrollTick = 0

/** 当前请求句柄（页面卸载时中断，避免回到后台还在收流） */
let ctl = null

/** Markdown 重算节流：模型每个字都可能推一个 delta，逐字重算会白白渲染几百次 */
let renderTimer = null
let renderIdx = -1

const canSend = computed(() => !sending.value && input.value.trim().length > 0)

function scrollToEnd() {
  nextTick(() => {
    scrollTick += 1
    scrollTop.value = 1000000 + scrollTick
  })
}

/** 合并短时间内的多次 delta，只渲染最后一帧 */
function scheduleRender(idx) {
  renderIdx = idx
  if (renderTimer) return
  renderTimer = setTimeout(flushRender, 90)
}

function flushRender() {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  if (renderIdx < 0) return
  const idx = renderIdx
  renderIdx = -1
  const m = messages.value[idx]
  if (m) m.html = mdToHtml(m.content)
  scrollToEnd()
}

function send(text) {
  if (sending.value) return
  const msg = String(text != null ? text : input.value).trim()
  if (!msg) return

  input.value = ''
  errorText.value = ''
  messages.value.push({ role: 'user', content: msg, html: '' })
  // 占位气泡：先出现在列表里（显示「正在思考…」），增量到达后往里填字
  const idx = messages.value.length
  messages.value.push({ role: 'assistant', content: '', html: '' })
  sending.value = true
  renderIdx = -1
  scrollToEnd()

  ctl = streamAiChat({
    message: msg,
    conversationId: convId.value,
    onDelta: (t) => {
      const m = messages.value[idx]
      if (!m) return
      m.content += t
      scheduleRender(idx)
    },
    // 会话 ID 只认后端下发的（首轮后端才生成），前端不自己造
    onConv: (id) => {
      convId.value = id
    },
    onError: (m) => {
      errorText.value = m || '请求失败'
    },
    onEnd: () => {
      if (renderTimer) {
        clearTimeout(renderTimer)
        renderTimer = null
      }
      renderIdx = -1
      const m = messages.value[idx]
      if (m && m.content) {
        m.html = mdToHtml(m.content)
      } else if (m) {
        // 一个字都没回来 ⇒ 不要留个空气泡在那儿（错误原因在上面的错误条里）
        messages.value.splice(idx, 1)
      }
      sending.value = false
      ctl = null
      scrollToEnd()
    }
  })
}

function newChat() {
  if (sending.value) {
    uni.showToast({ title: '正在回答，稍后再试', icon: 'none' })
    return
  }
  messages.value = []
  convId.value = ''
  errorText.value = ''
}

onUnload(() => {
  if (ctl) {
    ctl.abort()
    ctl = null
  }
})
</script>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  background: #0f0d16;
  position: relative;
}
/* 页面高度：H5 端要给导航栏留位（uni-app 的 H5 页头不是 100vh 的一部分），小程序端直接用视口高 */
/* #ifdef H5 */
.ai {
  height: calc(100vh - var(--window-top) - var(--window-bottom));
}
@media (min-width: 768px) {
  .ai {
    max-width: 760px;
    margin: 0 auto;
  }
}
/* #endif */
/* #ifndef H5 */
.ai {
  height: 100vh;
}
/* #endif */

.reset {
  position: absolute;
  right: 24rpx;
  top: 16rpx;
  z-index: 10;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(124, 92, 255, 0.2);
  border: 1rpx solid #3a3350;
}
.reset text {
  font-size: 22rpx;
  color: #cbbdff;
}

.ai__scroll {
  flex: 1;
  overflow: hidden;
  padding: 20rpx 28rpx 0;
  box-sizing: border-box;
}

/* ---------------- 欢迎态 ---------------- */
.intro {
  padding: 60rpx 20rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.intro__badge {
  width: 108rpx;
  height: 108rpx;
  border-radius: 50%;
  background: rgba(124, 92, 255, 0.16);
  border: 1rpx solid #3a3350;
  display: flex;
  align-items: center;
  justify-content: center;
}
.intro__badge-txt {
  font-size: 34rpx;
  color: #b9a9ff;
}
.intro__title {
  margin-top: 24rpx;
  font-size: 34rpx;
  color: #e9e7f2;
}
.intro__sub {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #8b8599;
  text-align: center;
  line-height: 1.6;
}
.intro__chips {
  margin-top: 36rpx;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
}
.chip {
  padding: 14rpx 24rpx;
  margin: 0 12rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(124, 92, 255, 0.14);
  border: 1rpx solid rgba(124, 92, 255, 0.36);
}
.chip__txt {
  font-size: 24rpx;
  color: #cbbdff;
}
.intro__note {
  margin-top: 24rpx;
  font-size: 21rpx;
  color: #8b8599;
  text-align: center;
  line-height: 1.7;
}

/* ---------------- 消息 ---------------- */
.row {
  display: flex;
  margin-bottom: 20rpx;
}
.row.user {
  justify-content: flex-end;
}
.row.assistant {
  justify-content: flex-start;
}
.bubble {
  max-width: 88%;
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  box-sizing: border-box;
}
.bubble.user {
  background: #7c5cff;
  border-bottom-right-radius: 6rpx;
}
.bubble.assistant {
  background: #1a1725;
  border: 1rpx solid #2a2538;
  border-bottom-left-radius: 6rpx;
}
.bubble__plain {
  font-size: 28rpx;
  color: #ffffff;
  line-height: 1.6;
  word-break: break-word;
}
.bubble__wait {
  font-size: 26rpx;
  color: #8b8599;
}
.tail {
  height: 24rpx;
}

/* ---------------- 错误条 ---------------- */
.err {
  flex: none;
  margin: 0 28rpx 12rpx;
  padding: 14rpx 18rpx;
  background: rgba(255, 176, 32, 0.1);
  border: 1rpx solid rgba(255, 176, 32, 0.32);
  border-radius: 14rpx;
}
.err__txt {
  font-size: 22rpx;
  color: #ffce7a;
  line-height: 1.6;
}

/* ---------------- 输入区 ---------------- */
.composer {
  flex: none;
  display: flex;
  align-items: flex-end;
  padding: 16rpx 24rpx;
  background: #16131f;
  border-top: 1rpx solid #2a2538;
  /* iPhone 全面屏底部安全区 */
  padding-bottom: calc(16rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
}
.composer__input {
  flex: 1;
  min-height: 72rpx;
  max-height: 220rpx;
  padding: 16rpx 22rpx;
  box-sizing: border-box;
  background: #231f31;
  border: 1rpx solid #2a2538;
  border-radius: 18rpx;
  color: #e9e7f2;
  font-size: 27rpx;
  line-height: 1.5;
}
.composer__ph {
  color: #8b8599;
  font-size: 26rpx;
}
.composer__send {
  flex: none;
  margin-left: 16rpx;
  padding: 0 30rpx;
  height: 72rpx;
  border-radius: 18rpx;
  background: #7c5cff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.composer__send--off {
  background: #332c4a;
}
.composer__send-txt {
  font-size: 26rpx;
  color: #ffffff;
}
</style>
