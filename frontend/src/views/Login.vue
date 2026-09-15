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

      <div class="tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <el-form @submit.prevent="submit">
        <!-- 账号输入：实时剔除非法字符（中文 / 空格 / 特殊符号）。
             ⚠️ 特意放行 @ 和 . —— 为将来「邮箱登录」留口子，不做粗暴剔除；
             真能否用于注册由 submit() 在注册分支按 USERNAME_RULE 判定。 -->
        <el-input
          v-model="username"
          placeholder="用户名"
          size="large"
          :prefix-icon="User"
          @input="onUsernameInput"
        />
        <el-input
          v-model="password"
          type="password"
          placeholder="密码"
          size="large"
          :prefix-icon="Lock"
          show-password
        />
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

      <p class="hint">账号 3-20 位，仅字母 / 数字 / 下划线；密码 6-32 位</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { useUserStore } from '@/store'
import { login, register } from '@/api/community'

const router = useRouter()
const userStore = useUserStore()

const mode = ref('login')
const username = ref('')
const password = ref('')
const loading = ref(false)
// C3：注册协议勾选状态（仅注册校验，登录不要求；勾选行本身也只在注册 Tab 渲染）
const agreed = ref(false)

/** 账号规则：与后端 `RegisterRequest#username` 及「修改账号」完全一致。 */
const USERNAME_RULE = /^[A-Za-z0-9_]{3,20}$/
/**
 * 实时过滤时**允许**的字符 —— 除规则内的字母/数字/下划线外，额外放行 `@` 和 `.`。
 * 目的：不把「用户想输邮箱」的字符当场吃掉，为将来支持邮箱登录留口子；
 * 这两个字符当下能否用于注册，由 submit() 里一条专门提示兜住。
 */
const USERNAME_TYPABLE = /[^A-Za-z0-9_@.]/g

let lastTipAt = 0
/** 过滤提示节流：2.5s 内只弹一次，避免连续输入时刷屏。 */
function tipUsernameOnce() {
  const now = Date.now()
  if (now - lastTipAt < 2500) return
  lastTipAt = now
  ElMessage.warning('账号只能包含字母、数字和下划线')
}

/**
 * 输入即时清洗。
 * 💡 Element Plus 在 IME 组合期间（isComposing）**不会**更新 v-model，组合结束才补一次
 * handleInput —— 所以中文输入能被完整过滤，且不会打断输入法候选框。
 */
function onUsernameInput(val) {
  const cleaned = String(val ?? '').replace(USERNAME_TYPABLE, '')
  if (cleaned === val) return
  username.value = cleaned
  tipUsernameOnce()
}

async function submit() {
  const u = username.value.trim()
  const p = password.value.trim()
  if (!u || !p) return ElMessage.warning('请输入用户名和密码')
  // C4：注册才校验账号格式与协议；登录**不校验字符集**（老账号、将来的邮箱登录都不该被卡）
  if (mode.value === 'register') {
    if (/[@.]/.test(u)) {
      return ElMessage.warning('邮箱注册暂未开放，请使用字母 / 数字 / 下划线的账号')
    }
    if (!USERNAME_RULE.test(u)) {
      return ElMessage.warning('账号需为 3-20 位字母、数字或下划线')
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
        : await register({ username: u, password: p, nickname: u })
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
</style>
