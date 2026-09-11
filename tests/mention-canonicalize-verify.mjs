// 9-08 @提及规范化验证：
//   1) 路径指向不存在的用户 → 保存后降级为纯文本 @显示名（无链接）
//   2) 显示名与路径 uid 的真实昵称不一致 → 保存后强制重写为真实昵称（显示=目标）
//   3) 正常提及不受影响
// 运行：cd tests && node mention-canonicalize-verify.mjs（需后端 8080 在跑）
const BASE = 'http://localhost:8080/api'

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => ({}))
  return json
}

let passed = 0
let failed = 0
function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name) }
}

console.log('[1] admin 登录')
const login = await api('POST', '/auth/login', null, { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
check('登录成功', login.code === 200 && login.data && login.data.token)
const token = login.data.token

const me = await api('GET', '/auth/me', token)
check('获取当前用户', me.code === 200 && me.data && me.data.id)
const adminId = me.data.id
const adminNick = me.data.nickname || me.data.username
console.log(`  admin id=${adminId} nickname=${adminNick}`)

// 找一个板块
const boards = await api('GET', '/boards', token)
check('板块列表', boards.code === 200 && Array.isArray(boards.data) && boards.data.length > 0)
const boardId = boards.data[0].id

console.log('[2] 创建含篡改提及的帖子（目标不存在 + 显示名错误 + 正常提及）')
const BIG_UID = 999999
const content = `测[@不存在的人](/user/${BIG_UID}) 和 [@错误显示名](/user/${adminId}) 以及正常 [@${adminNick}](/user/${adminId})`
const created = await api('POST', '/posts', token, {
  title: '提及规范化验证-' + Date.now(),
  content,
  boardId,
  gameId: null,
  type: 0
})
check('发帖成功（ADMIN 直发）', created.code === 200 && created.data && created.data.id)
const pid = created.data.id

const detail = await api('GET', '/posts/' + pid, token)
check('帖子详情可读', detail.code === 200 && detail.data && typeof detail.data.content === 'string')
const saved = detail.data.content
console.log('  保存后的 content =', saved)

check('不存在的 uid → 降级为纯文本（无链接语法）', !saved.includes(`/user/${BIG_UID}`) && saved.includes('@不存在的人'))
check('显示名错误 → 已重写为真实昵称', saved.includes(`[@${adminNick}](/user/${adminId})`))
check('显示名错误 → 原错误显示名已消失', !saved.includes('[@错误显示名]'))
check('正常提及保持不变', saved.includes(`[@${adminNick}](/user/${adminId})`))

console.log('[3] 清理测试帖子')
const del = await api('DELETE', '/posts/' + pid, token)
check('删除成功', del.code === 200)

console.log('')
console.log(`═══ @提及规范化验证：通过 ${passed} / 失败 ${failed} ═══`)
process.exit(failed > 0 ? 1 : 0)
