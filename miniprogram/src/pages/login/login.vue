<template>
  <view class="auth-page">
    <view class="auth-card">
      <!-- 模式切换（⚠️ 忘记密码是**独立视图**，不显示登录/注册 Tab —— 与主站一致） -->
      <view v-if="mode !== 'forgot'" class="seg">
        <text class="seg__item" :class="{ 'seg__item--on': mode === 'login' }" @click="switchMode('login')">登录</text>
        <text class="seg__item" :class="{ 'seg__item--on': mode === 'register' }" @click="switchMode('register')">注册</text>
      </view>
      <view v-else class="forgot-head">
        <text class="forgot-head__title">忘记密码</text>
        <text class="forgot-head__sub">可用绑定邮箱自助重置</text>
      </view>

      <!-- 账号id（忘记密码视图不需要） -->
      <view v-if="mode !== 'forgot'" class="field">
        <text class="field__label">账号id</text>
        <input
          v-model="username"
          class="field__input"
          :placeholder="mode === 'login' ? '账号id 或 邮箱' : '账号id（3-20 位字母/数字/下划线）'"
          placeholder-class="ph"
          @input="onUsernameInput"
        />
      </view>

      <!-- 密码（忘记密码视图用新密码两连，见下） -->
      <view v-if="mode !== 'forgot'" class="field">
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

      <!-- 忘记密码视图：绑定邮箱 → 验证码 → 新密码（字段与主站 fp* 一一对应） -->
      <template v-if="mode === 'forgot'">
        <view class="field">
          <text class="field__label">绑定邮箱</text>
          <input v-model="fpEmail" class="field__input" placeholder="注册时绑定的邮箱" placeholder-class="ph" />
        </view>
        <view class="field">
          <text class="field__label">邮箱验证码</text>
          <view class="field__row">
            <input v-model="fpCode" class="field__input field__input--code" type="number" maxlength="6" placeholder="6 位数字" placeholder-class="ph" />
            <text class="sendbtn" :class="{ 'sendbtn--off': fpCooldown > 0 || fpSending }" @click="onSendFpCode">
              {{ fpCooldown > 0 ? `${fpCooldown}s 后重发` : '获取验证码' }}
            </text>
          </view>
        </view>
        <view class="field">
          <text class="field__label">新密码</text>
          <input v-model="fpPwd" class="field__input" type="password" placeholder="新密码（6-32 位）" placeholder-class="ph" />
        </view>
        <view class="field">
          <text class="field__label">确认新密码</text>
          <input v-model="fpPwd2" class="field__input" type="password" placeholder="再输入一次新密码" placeholder-class="ph" />
        </view>
      </template>

      <button class="submit" :disabled="busy" @click="onSubmit">
        {{ submitText }}
      </button>

      <!-- 登录态：忘记密码入口（主站同款小链接） -->
      <view v-if="mode === 'login'" class="forgot-row">
        <text class="forgot-row__link" @click="goForgot">忘记密码？</text>
      </view>
      <!-- 忘记密码视图：回登录 -->
      <view v-if="mode === 'forgot'" class="forgot-row">
        <text class="forgot-row__link" @click="backToLogin">← 返回登录</text>
      </view>

      <!-- ⚠️ 协议勾选**只在注册 Tab 出现** —— 登录不涉及协议签署，摆在登录表单里是噪音（主站 C3 同款） -->
      <view v-if="mode === 'register'" class="agree" @click="agreed = !agreed">
        <text class="agree__box" :class="{ 'agree__box--on': agreed }">{{ agreed ? '✓' : '' }}</text>
        <text class="agree__text">我已阅读并同意</text>
        <text class="agree__link" @click.stop="openLegal('agreement')">《用户协议》</text>
        <text class="agree__text">与</text>
        <text class="agree__link" @click.stop="openLegal('privacy')">《隐私政策》</text>
      </view>

      <text class="hint">
        {{
          mode === 'login'
            ? '支持「账号id」或「邮箱」+ 密码登录；邮箱登录需该账号已绑定邮箱'
            : mode === 'forgot'
              ? '忘记密码可用绑定邮箱自助重置'
              : '账号id 3-20 位：字母 / 数字 / 下划线；密码 6-32 位'
        }}
      </text>
      <text v-if="mode !== 'forgot'" class="hint hint--sub">与主网站账号通用，注册后也可直接登录主站</text>
    </view>
  </view>
</template>

<script setup>
/**
 * 登录 / 注册 / 忘记密码 —— 账号体系与主站完全通用（同一套 user 表、同一组 /auth 接口）。
 *
 * 🚨 四层一致性铁律（账号规则改任何一层必须四处同步）：
 *   本页注册态的实时过滤 ↔ 前端提示语 ↔ 后端 `RegisterRequest#username` 的 @Pattern ↔ 提示语逐字列出放行字符。
 *   与主站 `Login.vue` 保持**逐字一致**：
 *     · 注册态过滤：只留字母 / 数字 / 下划线，剔除时 toast 回显被剔除的字符；
 *     · **登录态一律不过滤**（要能输邮箱登录）。
 *
 * 忘记密码（对齐主站同款交互）：
 *   · 独立视图，不显示登录/注册 Tab；入口在登录态的小链接；
 *   · ⚠️ 后端防枚举：未注册邮箱也返回成功 ⇒ 发码提示必须是
 *     「若该邮箱已注册，验证码将在 1 分钟内送达」，**不能**写「已发送到你的邮箱」；
 *   · 成功后**不自动登录**，回登录态让用户用新密码登。
 *
 * 协议勾选（主站 C3 同款）：
 *   · 只在注册 Tab 出现；未勾选注册会被拦截；
 *   · 切走注册 Tab 时重置勾选，避免「注册时勾过、切回来还留着」造成误判。
 */
import { ref, computed } from 'vue'
import { login, register, sendEmailCode, resetPassword } from '../../api/auth'
import { setToken } from '../../api/request'
import { setUser } from '../../utils/store'
import { LEGAL_LINKS } from '../../api/config'

// mode：login（登录）/ register（注册）/ forgot（忘记密码）
const mode = ref('login')
const username = ref('')
const password = ref('')
const email = ref('')
const emailCode = ref('')
const busy = ref(false)
const sending = ref(false)
const cooldown = ref(0)

// 协议勾选（仅注册校验）
const agreed = ref(false)

// ---- 忘记密码 ----
const fpEmail = ref('')
const fpCode = ref('')
const fpPwd = ref('')
const fpPwd2 = ref('')
const fpSending = ref(false)
const fpCooldown = ref(0)

/** 账号规则：与后端 `RegisterRequest#username` 及主站完全一致 */
const USERNAME_RE = /^[A-Za-z0-9_]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const submitText = computed(() => {
  if (mode.value === 'forgot') return busy.value ? '请稍候…' : '重置密码'
  return busy.value ? '请稍候…' : mode.value === 'login' ? '登录' : '注册并登录'
})

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
  // 主站同款：协议勾选只在注册有意义，切走就重置
  if (m !== 'register') agreed.value = false
}

/** 打开主站协议页（H5 直接新窗口；小程序端没有 webview 通道，回退成复制提示） */
function openLegal(kind) {
  const url = LEGAL_LINKS[kind]
  // #ifdef H5
  window.open(url, '_blank')
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: url })
  // #endif
}

/** 60s 倒计时（注册 / 忘记密码各自独立冷却，与主站一致） */
function startCooling(target) {
  target.value = 60
  const t = setInterval(() => {
    target.value -= 1
    if (target.value <= 0) clearInterval(t)
  }, 1000)
}

async function onSendCode() {
  const mail = email.value.trim()
  if (!mail || !EMAIL_RE.test(mail)) {
    return uni.showToast({ title: '请先填写正确的邮箱', icon: 'none' })
  }
  if (cooldown.value > 0 || sending.value) return
  sending.value = true
  try {
    await sendEmailCode(mail, 'register')
    uni.showToast({ title: '验证码已发送，请查收邮箱', icon: 'none' })
    startCooling(cooldown)
  } catch (e) {
    /* 错误文案已由请求层 toast 后端原文 */
  } finally {
    sending.value = false
  }
}

/** 进入忘记密码视图；若账号栏里已经填了邮箱，顺带带过去省一次输入（主站同款） */
function goForgot() {
  const u = username.value.trim()
  fpEmail.value = u.includes('@') ? u : ''
  fpCode.value = ''
  fpPwd.value = ''
  fpPwd2.value = ''
  mode.value = 'forgot'
}

function backToLogin() {
  mode.value = 'login'
}

/** 忘记密码：给绑定邮箱发验证码（scene='reset'） */
async function onSendFpCode() {
  const mail = fpEmail.value.trim()
  if (!mail) return uni.showToast({ title: '请先填写绑定邮箱', icon: 'none' })
  if (!EMAIL_RE.test(mail)) return uni.showToast({ title: '邮箱格式不正确', icon: 'none' })
  if (fpCooldown.value > 0 || fpSending.value) return
  fpSending.value = true
  try {
    await sendEmailCode(mail, 'reset')
    // ⚠️ 防枚举设计：后端对「未注册的邮箱」同样返回成功，所以这里不能写"已发送到你的邮箱"，
    //    否则等于告诉外面"这个邮箱存在"（文案与主站逐字一致）。
    uni.showToast({ title: '若该邮箱已注册，验证码将在 1 分钟内送达', icon: 'none', duration: 2500 })
    startCooling(fpCooldown)
  } catch (e) {
    /* 错误文案已由请求层 toast 后端原文 */
  } finally {
    fpSending.value = false
  }
}

/** 忘记密码提交。校验顺序与主站一致。 */
async function submitForgot() {
  const mail = fpEmail.value.trim()
  const code = fpCode.value.trim()
  const p1 = fpPwd.value
  const p2 = fpPwd2.value
  if (!mail || !code || !p1 || !p2) return uni.showToast({ title: '请填写完整', icon: 'none' })
  if (!EMAIL_RE.test(mail)) return uni.showToast({ title: '邮箱格式不正确', icon: 'none' })
  if (!/^\d{6}$/.test(code)) return uni.showToast({ title: '邮箱验证码为 6 位数字', icon: 'none' })
  if (p1.length < 6 || p1.length > 32) return uni.showToast({ title: '密码长度 6-32 位', icon: 'none' })
  if (p1 !== p2) return uni.showToast({ title: '两次输入的新密码不一致', icon: 'none' })

  busy.value = true
  try {
    await resetPassword({ email: mail, emailCode: code, newPassword: p1 })
    // 与主站一致：成功后不自动登录，回登录态
    uni.showToast({ title: '密码已重置，请用新密码登录', icon: 'none' })
    backToLogin()
  } catch (e) {
    /* 错误文案已由请求层 toast 后端原文 */
  } finally {
    busy.value = false
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
    // 主站同款：注册必须先勾选协议（勾选行只在注册 Tab 出现）
    if (!agreed.value) return '请先阅读并同意《用户协议》与《隐私政策》'
  }
  return ''
}

async function onSubmit() {
  if (busy.value) return
  if (mode.value === 'forgot') return submitForgot()
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
/* 忘记密码视图的小标题（该视图不显示登录/注册 Tab，与主站同款） */
.forgot-head {
  margin-bottom: 32rpx;
}
.forgot-head__title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--c-text-1, #f2f0f7);
}
.forgot-head__sub {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--c-text-3, #8b8599);
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
/* 「忘记密码？」/「返回登录」入口行 */
.forgot-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 20rpx;
}
.forgot-row__link {
  font-size: 24rpx;
  color: var(--c-primary, #7c6cff);
}
/* 协议勾选行（置于提交按钮下方；注册时未勾选会被拦截） */
.agree {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 24rpx;
  font-size: 22rpx;
}
.agree__box {
  width: 32rpx;
  height: 32rpx;
  line-height: 30rpx;
  text-align: center;
  margin-right: 12rpx;
  border: 1rpx solid var(--c-border, #2c2740);
  border-radius: 8rpx;
  color: transparent;
  font-size: 22rpx;
  flex-shrink: 0;
}
.agree__box--on {
  background: var(--c-primary, #7c6cff);
  border-color: var(--c-primary, #7c6cff);
  color: #fff;
}
.agree__text {
  color: var(--c-text-2, #a49eb6);
}
.agree__link {
  color: var(--c-primary, #7c6cff);
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
