<template>
  <view class="auth-page">
    <view class="auth-card">
      <!-- 模式切换 -->
      <view class="seg">
        <text class="seg__item" :class="{ 'seg__item--on': mode === 'login' }" @click="switchMode('login')">登录</text>
        <text class="seg__item" :class="{ 'seg__item--on': mode === 'register' }" @click="switchMode('register')">注册</text>
      </view>

      <!-- 账号id -->
      <view class="field">
        <text class="field__label">账号id</text>
        <input
          v-model="username"
          class="field__input"
          :placeholder="mode === 'login' ? '账号id 或 邮箱' : '账号id（3-20 位字母/数字/下划线）'"
          placeholder-class="ph"
          @input="onUsernameInput"
        />
      </view>

      <!-- 密码 -->
      <view class="field">
        <text class="field__label">密码</text>
        <input
          v-model="password"
          class="field__input"
          type="password"
          :placeholder="mode === 'login' ? '密码' : '密码（6-32 位）'"
          placeholder-class="ph"
        />
      </view>

      <!-- 注册态：邮箱 + 验证码（字段顺序与主站一致：账号 → 密码 → 邮箱 → 验证码） -->
      <template v-if="mode === 'register'">
        <view class="field">
          <text class="field__label">邮箱</text>
          <input v-model="email" class="field__input" placeholder="邮箱（用于验证与找回密码）" placeholder-class="ph" />
        </view>
        <view class="field">
          <text class="field__label">验证码</text>
          <view class="field__row">
            <input v-model="emailCode" class="field__input field__input--code" type="number" maxlength="6" placeholder="6 位数字" placeholder-class="ph" />
            <text class="sendbtn" :class="{ 'sendbtn--off': cooldown > 0 || sending }" @click="onSendCode">
              {{ cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码' }}
            </text>
          </view>
        </view>
      </template>

      <button class="submit" :disabled="busy" @click="onSubmit">
        {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
      </button>

      <text class="hint">
        {{
          mode === 'login'
            ? '支持「账号id」或「邮箱」+ 密码登录；邮箱登录需该账号已绑定邮箱'
            : '账号id 3-20 位：字母 / 数字 / 下划线；密码 6-32 位'
        }}
      </text>
      <text class="hint hint--sub">与主网站账号通用，注册后也可直接登录主站</text>
    </view>
  </view>
</template>

<script setup>
/**
 * 登录 / 注册 —— 账号体系与主站完全通用（同一套 user 表、同一组 /auth 接口）。
 *
 * 🚨 四层一致性铁律（账号规则改任何一层必须四处同步）：
 *   本页注册态的实时过滤 ↔ 前端提示语 ↔ 后端 `RegisterRequest#username` 的 @Pattern ↔ 提示语逐字列出放行字符。
 *   与主站 `Login.vue` 保持**逐字一致**：
 *     · 注册态过滤：只留字母 / 数字 / 下划线，剔除时 toast 回显被剔除的字符；
 *     · **登录态一律不过滤**（要能输邮箱登录）。
 */
import { ref } from 'vue'
import { login, register, sendEmailCode } from '../../api/auth'
import { setToken } from '../../api/request'
import { setUser } from '../../utils/store'

const mode = ref('login')
const username = ref('')
const password = ref('')
const email = ref('')
const emailCode = ref('')
const busy = ref(false)
const sending = ref(false)
const cooldown = ref(0)

/** 账号规则：与后端 `RegisterRequest#username` 及主站完全一致 */
const USERNAME_RE = /^[A-Za-z0-9_]+$/

let lastFilterTipAt = 0

/** 注册态账号id 实时过滤（登录态不进这个分支 —— 要能输邮箱） */
function onUsernameInput(e) {
  if (mode.value !== 'register') return
  const raw = e.detail.value || ''
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '')
  if (cleaned !== raw) {
    username.value = cleaned
    // 回显被剔除的字符：否则用户只会觉得"字打了却消失"（提示节流 2.5s，与主站一致）
    const now = Date.now()
    if (now - lastFilterTipAt > 2500) {
      lastFilterTipAt = now
      const removed = [...raw].filter((ch) => !USERNAME_RE.test(ch)).join(' ')
      uni.showToast({
        title: `账号id 只能输入字母、数字、下划线（已剔除：${removed || '非法字符'}）`,
        icon: 'none',
        duration: 2500
      })
    }
  }
}

function switchMode(m) {
  mode.value = m
}

async function onSendCode() {
  const mail = email.value.trim()
  if (!mail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return uni.showToast({ title: '请先填写正确的邮箱', icon: 'none' })
  }
  if (cooldown.value > 0 || sending.value) return
  sending.value = true
  try {
    await sendEmailCode(mail, 'register')
    uni.showToast({ title: '验证码已发送，请查收邮箱', icon: 'none' })
    cooldown.value = 60
    const t = setInterval(() => {
      cooldown.value -= 1
      if (cooldown.value <= 0) clearInterval(t)
    }, 1000)
  } catch (e) {
    /* 错误文案已由请求层 toast 后端原文 */
  } finally {
    sending.value = false
  }
}

function validate() {
  const u = username.value.trim()
  const p = password.value
  if (mode.value === 'register' && (!u || u.length < 3 || u.length > 20 || !USERNAME_RE.test(u))) {
    return '账号id 需 3-20 位字母、数字或下划线'
  }
  if (!u) return '请输入账号id 或邮箱'
  if (!p || p.length < 6 || p.length > 32) return '密码长度为 6-32 位'
  if (mode.value === 'register') {
    if (!email.value.trim()) return '请填写邮箱'
    if (!/^\d{6}$/.test(emailCode.value)) return '请输入 6 位数字验证码'
  }
  return ''
}

async function onSubmit() {
  if (busy.value) return
  const bad = validate()
  if (bad) return uni.showToast({ title: bad, icon: 'none' })
  busy.value = true
  try {
    const data =
      mode.value === 'login'
        ? await login({ username: username.value.trim(), password: password.value })
        : await register({
            username: username.value.trim(),
            password: password.value,
            email: email.value.trim(),
            emailCode: emailCode.value.trim()
          })
    // 与主站登录响应结构一致：{ token, user }
    setToken(data.token)
    setUser(data.user)
    uni.showToast({ title: '登录成功', icon: 'success' })
    setTimeout(() => uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/my/my' }) }), 600)
  } catch (e) {
    /* 失败文案已由请求层 toast 后端原文（如「账号或密码错误」） */
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  padding: 48rpx 32rpx;
  background: var(--c-bg, #14111f);
  box-sizing: border-box;
}
.auth-card {
  background: var(--c-card, #1a1725);
  border: 1rpx solid var(--c-border, #2c2740);
  border-radius: 24rpx;
  padding: 40rpx 32rpx 32rpx;
}
.seg {
  display: flex;
  background: var(--c-bg, #14111f);
  border-radius: 16rpx;
  padding: 6rpx;
  margin-bottom: 32rpx;
}
.seg__item {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 28rpx;
  color: var(--c-text-2, #a49eb6);
  border-radius: 12rpx;
}
.seg__item--on {
  background: var(--c-primary, #7c6cff);
  color: #fff;
  font-weight: 600;
}
.field {
  margin-bottom: 24rpx;
}
.field__label {
  display: block;
  font-size: 24rpx;
  color: var(--c-text-2, #a49eb6);
  margin-bottom: 10rpx;
}
.field__input {
  width: 100%;
  height: 84rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  background: var(--c-bg, #14111f);
  border: 1rpx solid var(--c-border, #2c2740);
  border-radius: 14rpx;
  color: var(--c-text-1, #f2f0f7);
  font-size: 28rpx;
}
.field__row {
  display: flex;
  gap: 16rpx;
  align-items: center;
}
.field__input--code {
  flex: 1;
}
.sendbtn {
  flex-shrink: 0;
  padding: 0 20rpx;
  height: 84rpx;
  line-height: 84rpx;
  font-size: 24rpx;
  color: var(--c-primary, #7c6cff);
}
.sendbtn--off {
  color: var(--c-text-3, #8b8599);
}
.submit {
  margin-top: 12rpx;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 16rpx;
  background: var(--c-primary, #7c6cff);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
}
.submit[disabled] {
  opacity: 0.6;
}
.hint {
  display: block;
  margin-top: 24rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--c-text-3, #8b8599);
}
.hint--sub {
  margin-top: 8rpx;
}
</style>
