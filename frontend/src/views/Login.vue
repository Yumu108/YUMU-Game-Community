<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand">
        <span class="logo-mark">Y</span>
        <div>
          <div class="brand-name">YUMU 游戏社区</div>
          <div class="brand-sub">年轻人的热门游戏讨论站</div>
        </div>
      </div>

      <!-- ================= 忘记密码（独立视图，不显示登录/注册 Tab） ================= -->
      <template v-if="mode === 'forgot'">
        <div class="sub-head">
          <span class="sub-title">重置密码</span>
          <span class="sub-desc">通过绑定邮箱验证身份</span>
        </div>

        <el-form @submit.prevent="submitForgot">
          <div class="code-row">
            <el-input v-model="fpEmail" placeholder="绑定邮箱" size="large">
              <template #prefix><span class="ic">📧</span></template>
            </el-input>
            <el-button
              class="code-btn"
              size="large"
              :disabled="fpCooling > 0"
              :loading="fpSending"
              @click="sendFpCode"
            >
              {{ fpCooling > 0 ? `${fpCooling}s` : '发送验证码' }}
            </el-button>
          </div>

          <el-input v-model="fpCode" placeholder="邮箱验证码（6 位）" size="large" maxlength="6">
            <template #prefix><span class="ic">🔢</span></template>
          </el-input>
          <el-input v-model="fpPwd" type="password" placeholder="新密码 6-32 位" size="large" show-password>
            <template #prefix><span class="ic">🔒</span></template>
          </el-input>
          <el-input v-model="fpPwd2" type="password" placeholder="确认新密码" size="large" show-password>
            <template #prefix><span class="ic">🔒</span></template>
          </el-input>

          <el-button type="primary" size="large" class="submit" native-type="submit" :loading="loading">
            重置密码
          </el-button>
          <el-button text size="large" class="guest" @click="backToLogin">← 返回登录</el-button>
        </el-form>

        <p class="hint">
          重置成功后旧密码立即失效，请用新密码重新登录<br />
          原邮箱收不到验证码？请联系管理员处理
        </p>
      </template>

      <!-- ================= 登录 / 注册 ================= -->
      <template v-else>
        <div class="tabs">
          <button :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
          <button :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
        </div>

        <el-form @submit.prevent="submit">
          <!-- 账号输入。⚠️ 这里**不再实时过滤字符**：
               登录态要能输入邮箱（含 @ . - + 等），过滤会直接把邮箱吃掉；
               只有注册态的账号id才需要按 [A-Za-z0-9_] 清洗 —— 分流逻辑见 onUsernameInput。 -->
          <el-input
            v-model="username"
            :placeholder="mode === 'login' ? '账号id 或 邮箱' : '账号id（3-20 位字母/数字/下划线）'"
            size="large"
            @input="onUsernameInput"
          >
            <template #prefix><span class="ic">👤</span></template>
          </el-input>

          <el-input v-model="password" type="password" placeholder="密码" size="large" show-password>
            <template #prefix><span class="ic">🔒</span></template>
          </el-input>

          <!-- 注册态字段顺序（按产品要求固定）：账号id → 密码 → 邮箱 → 验证码 -->
          <template v-if="mode === 'register'">
            <div class="code-row">
              <el-input v-model="email" placeholder="邮箱" size="large">
                <template #prefix><span class="ic">📧</span></template>
              </el-input>
              <el-button
                class="code-btn"
                size="large"
                :disabled="regCooling > 0"
                :loading="regSending"
                @click="sendRegCode"
              >
                {{ regCooling > 0 ? `${regCooling}s` : '发送验证码' }}
              </el-button>
            </div>
            <el-input v-model="emailCode" placeholder="邮箱验证码（6 位）" size="large" maxlength="6">
              <template #prefix><span class="ic">🔢</span></template>
            </el-input>
          </template>

          <div v-if="mode === 'login'" class="forgot-row">
            <a @click="goForgot">忘记密码？</a>
          </div>

          <el-button type="primary" size="large" class="submit" native-type="submit" :loading="loading">
            {{ mode === 'login' ? '登录' : '注册并登录' }}
          </el-button>
          <el-button text size="large" class="guest" @click="enterGuest">游客浏览</el-button>
          <!-- C3：协议勾选**只在注册 Tab 出现** —— 登录不涉及协议签署，摆在登录表单里是噪音。 -->
          <el-checkbox v-if="mode === 'register'" v-model="agreed" class="agree" size="small">
            我已阅读并同意
            <router-link to="/agreement" class="agree-link" @click.stop>《用户协议》</router-link>
            与
            <router-link to="/privacy" class="agree-link" @click.stop>《隐私政策》</router-link>
          </el-checkbox>
        </el-form>

        <!-- ⚠️ 账号文案必须与实际校验范围逐字对应。
             9-15 起「@ 和 .」的口子收掉了：邮箱登录已由**独立的邮箱字段**承担，
             账号id 只收字母/数字/下划线（历史上也就没人能注册成含 @ 的账号名）。 -->
        <p class="hint">
          {{ mode === 'login'
            ? '支持「账号id」或「邮箱」+ 密码登录；邮箱登录需该账号已绑定邮箱'
            : '账号id 3-20 位：字母 / 数字 / 下划线；密码 6-32 位' }}<br />
          {{ mode === 'login'
            ? '忘记密码可用绑定邮箱自助重置'
            : '邮箱验证码 5 分钟内有效，同一邮箱 60 秒可重发' }}
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store'
import { login, register, sendEmailCode, resetPassword } from '@/api/community'

const router = useRouter()
const userStore = useUserStore()

// 三种视图：login（登录）/ register（注册）/ forgot（忘记密码）
const mode = ref('login')
const username = ref('')
const password = ref('')
const loading = ref(false)
// C3：注册协议勾选状态（仅注册校验，登录不要求；勾选行本身也只在注册 Tab 渲染）
const agreed = ref(false)

// ---- 注册：邮箱 + 验证码（9-15 起邮箱为后端必填） ----
const email = ref('')
const emailCode = ref('')
const regSending = ref(false)
/** 注册「发送验证码」按钮的冷却倒计时（秒），0 表示可点。 */
const regCooling = ref(0)

// ---- 忘记密码 ----
const fpEmail = ref('')
const fpCode = ref('')
const fpPwd = ref('')
const fpPwd2 = ref('')
const fpSending = ref(false)
const fpCooling = ref(0)

/** 账号规则：与后端 `RegisterRequest#username` 及「修改账号」完全一致。 */
const USERNAME_RULE = /^[A-Za-z0-9_]{3,20}$/
/**
 * 注册态账号id 的实时过滤**取反**字符类：只留字母 / 数字 / 下划线。
 *
 * 📌 9-15 的收口：此前特意放行 `@` 和 `.`（"为邮箱登录留口子"），结果造成
 *    「能输 @ . 却只提示下划线」的自相矛盾。现在邮箱登录已由**独立的邮箱字段**承担，
 *    账号id 不再需要这两个字符，于是收回干净规则。
 *
 * 🚨 但**登录态一律不过滤** —— 登录框里要能输入邮箱（含 @ . - + 等），
 *    过滤会把邮箱直接吃掉。分流见 onUsernameInput。
 */
const USERNAME_TYPABLE = /[^A-Za-z0-9_]/g
/** 与 USERNAME_TYPABLE 互补，用于回显「刚才被吃掉的字符」。 */
const USERNAME_DROP = /[^A-Za-z0-9_]/g

let lastTipAt = 0
/** 过滤提示节流：2.5s 内只弹一次，避免连续输入时刷屏。 */
function tipUsernameOnce(dropped) {
  const now = Date.now()
  if (now - lastTipAt < 2500) return
  lastTipAt = now
  // 回显被剔除的字符：否则用户只会觉得"字打了却消失"，不知道是自己打了非法字符
  const shown = dropped?.length ? `（已忽略：${dropped.join(' ')}）` : ''
  ElMessage.warning(`账号id 只能输入字母、数字、下划线${shown}`)
}

/**
 * 输入即时清洗（**只在注册态生效**）。
 *
 * 💡 Element Plus 在 IME 组合期间（isComposing）**不会**更新 v-model，组合结束才补一次
 * handleInput —— 所以中文输入能被完整过滤，且不会打断输入法候选框。
 */
function onUsernameInput(val) {
  // 登录态要能输邮箱，绝不能过滤
  if (mode.value !== 'register') return
  const raw = String(val ?? '')
  const cleaned = raw.replace(USERNAME_TYPABLE, '')
  if (cleaned === raw) return
  username.value = cleaned
  // 去重后回显（空格用「空格」表示，否则提示里看不见）
  const dropped = [...new Set(raw.match(USERNAME_DROP) || [])].map((c) =>
    c === ' ' ? '空格' : c
  )
  tipUsernameOnce(dropped)
}

/** 邮箱格式（前端预校验；最终以后端 @Email 为准）。 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function submit() {
  const u = username.value.trim()
  const p = password.value.trim()
  if (!u || !p) {
    return ElMessage.warning(mode.value === 'login' ? '请输入账号id（或邮箱）和密码' : '请填写账号id 和密码')
  }

  // C4：只有注册才校验格式；登录**不校验字符集**（老账号、邮箱登录都不该被卡）
  if (mode.value === 'register') {
    if (!USERNAME_RULE.test(u)) {
      return ElMessage.warning('账号id 需为 3-20 位字母、数字或下划线')
    }
    const mail = email.value.trim()
    if (!EMAIL_RE.test(mail)) {
      return ElMessage.warning('请填写正确的邮箱')
    }
    if (!/^\d{6}$/.test(emailCode.value.trim())) {
      return ElMessage.warning('请填写 6 位邮箱验证码')
    }
    // C3：注册必须先勾选协议
    if (!agreed.value) {
      return ElMessage.warning('请先阅读并勾选《用户协议》与《隐私政策》')
    }
  }

  loading.value = true
  try {
    const data =
      mode.value === 'login'
        ? await login({ username: u, password: p })
        : await register({
            username: u,
            password: p,
            nickname: u,
            email: email.value.trim(),
            emailCode: emailCode.value.trim()
          })
    // 后端返回 nickname，组件统一用 userInfo.name 展示，这里做一次映射
    userStore.setToken(data.token)
    userStore.setUserInfo({
      id: data.user.id,
      name: data.user.nickname,
      avatar: data.user.avatar || '🙂',
      roles: data.user.roles
    })
    ElMessage.success(mode.value === 'login' ? '登录成功' : '注册成功，已自动登录')
    router.push('/')
  } catch (e) {
    // 错误提示已由 request 拦截器统一处理，这里无需重复
  } finally {
    loading.value = false
  }
}

/**
 * 「发送验证码」的 60 秒冷却倒计时（与后端 code-cooldown-seconds 对齐，
 * 提前给用户一个可见的等待预期，而不是等点击报 429 才知道要等）。
 */
function startCooling(coolingRef) {
  coolingRef.value = 60
  const timer = setInterval(() => {
    coolingRef.value -= 1
    if (coolingRef.value <= 0) clearInterval(timer)
  }, 1000)
}

/** 切换登录 / 注册 Tab。 */
function switchMode(m) {
  mode.value = m
  password.value = ''
  // 协议勾选只在注册有意义：切走就重置，避免"注册时勾过、切回来还留着"造成误判
  agreed.value = false
}

/** 注册：给邮箱发验证码（后端会先查邮箱是否已被占用）。 */
async function sendRegCode() {
  const mail = email.value.trim()
  if (!mail) return ElMessage.warning('请先填写邮箱')
  if (!EMAIL_RE.test(mail)) return ElMessage.warning('邮箱格式不正确')
  regSending.value = true
  try {
    await sendEmailCode(mail, 'register')
    ElMessage.success('验证码已发送，请查收邮件（5 分钟内有效）')
    startCooling(regCooling)
  } catch (e) {
    // 拦截器已提示（例如「该邮箱已被注册」）
  } finally {
    regSending.value = false
  }
}

/** 进入忘记密码视图；若账号栏里已经填了邮箱，顺带带过去省一次输入。 */
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

/** 忘记密码：给绑定邮箱发验证码。 */
async function sendFpCode() {
  const mail = fpEmail.value.trim()
  if (!mail) return ElMessage.warning('请先填写绑定邮箱')
  if (!EMAIL_RE.test(mail)) return ElMessage.warning('邮箱格式不正确')
  fpSending.value = true
  try {
    await sendEmailCode(mail, 'reset')
    // ⚠️ 防枚举设计：后端对「未注册的邮箱」同样返回成功，所以这里不能写"已发送到你的邮箱"，
    //    否则等于告诉外面"这个邮箱存在"（攻击者可用它批量探测）。
    ElMessage.success('若该邮箱已注册，验证码将在 1 分钟内送达')
    startCooling(fpCooling)
  } catch (e) {
    // 拦截器已提示
  } finally {
    fpSending.value = false
  }
}

/** 忘记密码：提交重置。成功后不自动登录，回到登录态让用户用新密码登。 */
async function submitForgot() {
  const mail = fpEmail.value.trim()
  const code = fpCode.value.trim()
  const p1 = fpPwd.value.trim()
  const p2 = fpPwd2.value.trim()
  if (!mail || !code || !p1 || !p2) return ElMessage.warning('请填写完整')
  if (!EMAIL_RE.test(mail)) return ElMessage.warning('邮箱格式不正确')
  if (!/^\d{6}$/.test(code)) return ElMessage.warning('邮箱验证码为 6 位数字')
  if (p1.length < 6 || p1.length > 32) return ElMessage.warning('密码长度 6-32 位')
  if (p1 !== p2) return ElMessage.warning('两次输入的新密码不一致')

  loading.value = true
  try {
    await resetPassword({ email: mail, emailCode: code, newPassword: p1 })
    ElMessage.success('密码已重置，请用新密码登录')
    backToLogin()
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

function enterGuest() {
  router.push('/')
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: grid;
  /* ⚠️ 必须显式给列轨道：默认单列 auto 轨道会被定宽卡片（.login-card width:360px）撑开，
     连带让卡片的 max-width:100% 失去参照而失效 → 视口 <400px 时横向溢出 20px。
     minmax(0,1fr) 把轨道钉在可用宽度上，max-width 才真正生效。 */
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  background:
    radial-gradient(900px 500px at 50% -10%, rgba(124, 92, 255, 0.18), transparent),
    var(--bg);
  padding: 20px;
}
.login-card {
  width: 360px;
  max-width: 100%;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 28px 26px;
  box-shadow: var(--shadow);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}
.logo-mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 22px;
  color: #fff;
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
}
.brand-name {
  font-weight: 800;
  font-size: 17px;
  color: var(--t1);
}
.brand-sub {
  font-size: 12px;
  color: var(--t3);
}
.tabs {
  display: flex;
  gap: 6px;
  background: var(--bg-1);
  padding: 4px;
  border-radius: 10px;
  margin-bottom: 20px;
}
.tabs button {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--t2);
  font-weight: 600;
  padding: 8px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 14px;
}
.tabs button.active {
  background: var(--brand);
  color: #fff;
}
.login-card :deep(.el-input) {
  margin-bottom: 14px;
}
.submit {
  width: 100%;
  background: var(--brand);
  border-color: var(--brand);
  font-weight: 700;
}
/* 🚨 Element Plus 对相邻按钮有 `.el-button + .el-button { margin-left: 12px }`，
   而 .guest 是 width:100% —— 两者叠加会把整块右移 12px（实测 right 越界），视觉上就是"歪了"。
   入口 CSS 早于懒加载的 el-button.css 加载，同特异性拼不过它，故用 :deep() 提到
   `.login-card[data-v-x] .el-button + .el-button`（0,3,0）压过 Element 的（0,2,0）。 */
.login-card :deep(.el-button + .el-button) {
  margin-left: 0;
}
.guest {
  width: 100%;
  color: var(--t2);
  font-weight: 600;
  margin-top: 8px;
}
.guest:hover {
  color: var(--brand);
}
.hint {
  margin: 14px 0 0;
  font-size: 11.5px;
  color: var(--t3);
  text-align: center;
  line-height: 1.7;
}
/* C3：协议勾选行（置于「游客浏览」下方；注册时未勾选会被拦截）
   ⚠️ el-checkbox 默认 white-space:nowrap —— 这行文案不可收缩，会把 .login-wrap 的
   grid 单列 auto 轨道撑宽，连带让卡片的 max-width:100% 失去参照而失效，
   结果是 360px 视口横向溢出。必须允许折行 + 允许 flex 子项收缩。 */
.agree {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  white-space: normal;
  margin: 10px 0 0;
}
.agree :deep(.el-checkbox__label) {
  font-size: 12px;
  line-height: 1.5;
  color: var(--t2);
  white-space: normal;
  word-break: break-word;
  min-width: 0;
}
/* 暗色主题适配：Element 的 checkbox 默认填充是 --el-fill-color-blank（纯白），
   在 #16181f 卡片上就是一块白色实心方块，极易被误读成"已勾选"。改成深底 + 描边。 */
.agree :deep(.el-checkbox__inner) {
  background-color: var(--bg-3);
  border-color: var(--border);
}
.agree :deep(.el-checkbox__inner:hover) {
  border-color: var(--brand);
}
.agree :deep(.is-checked .el-checkbox__inner) {
  background-color: var(--brand);
  border-color: var(--brand);
}
.agree-link {
  color: var(--brand);
  text-decoration: none;
}
.agree-link:hover {
  text-decoration: underline;
}

/* ================= 9-15：邮箱注册 / 忘记密码 ================= */

/* 输入框前缀的 emoji 图标。
   用 #prefix 插槽而不是 :prefix-icon —— @element-plus/icons-vue 不归按需插件管，
   新图标必须手工加进 main.js 的清单，否则只会空白 + 一条 console warning。 */
.ic {
  font-size: 14px;
  line-height: 1;
}

/* 「邮箱 + 发送验证码」复合行 */
.code-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
}
/* ⚠️ 必须清掉 el-input 自带的 margin-bottom：外层 .login-card :deep(.el-input) 给了 14px，
   留着会让按钮与输入框高度对不齐（按钮没有 margin）。两条规则特异性相同，靠"后写的生效"。 */
.code-row :deep(.el-input) {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}
.code-btn {
  flex: 0 0 auto;
  background: var(--brand-soft);
  border-color: var(--brand);
  color: #b8a6ff;
  font-weight: 600;
  font-size: 13px;
}
.code-btn :deep(span) {
  white-space: nowrap;
}

/* 「忘记密码？」入口 */
.forgot-row {
  text-align: right;
  margin: -4px 0 12px;
}
.forgot-row a {
  color: var(--brand);
  font-size: 12.5px;
  cursor: pointer;
}
.forgot-row a:hover {
  text-decoration: underline;
}

/* 忘记密码视图的小标题（该视图不显示登录/注册 Tab） */
.sub-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 16px;
}
.sub-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--t1);
}
.sub-desc {
  font-size: 12px;
  color: var(--t3);
}
</style>
