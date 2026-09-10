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
        <el-input v-model="username" placeholder="用户名 / 邮箱" size="large" :prefix-icon="User" />
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
      </el-form>

      <p class="hint">已接入后端：用户名 3-20 位、密码 6-32 位；未注册可直接「注册并登录」</p>
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
// C3：注册协议勾选状态（仅注册校验，登录不要求）
const agreed = ref(false)

async function submit() {
  const u = username.value.trim()
  const p = password.value.trim()
  if (!u || !p) return ElMessage.warning('请输入用户名和密码')
  // C3：注册必须先勾选协议
  if (mode.value === 'register' && !agreed.value) {
    return ElMessage.warning('请先阅读并勾选《用户协议》与《隐私政策》')
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
/* C3：协议勾选行 */
.agree {
  margin: 2px 0 14px;
}
.agree :deep(.el-checkbox__label) {
  font-size: 12px;
  color: var(--t2);
}
.agree-link {
  color: var(--brand);
  text-decoration: none;
}
.agree-link:hover {
  text-decoration: underline;
}
</style>
