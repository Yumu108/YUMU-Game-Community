// 管理员审计日志（027）验证：
//   1. 权限边界：匿名 / 普通用户不可读，仅 ADMIN 可读
//   2. 动作码字典下发（保证前端下拉与写库动作码同源）
//   3. 触发真实管理动作 → 审计落库且字段完整（操作人/对象/IP/中文标签）
//   4. 四种筛选（动作码 / 对象类型 / 操作人 / 时间范围）生效
//   5. 分页契约
// 运行：cd tests && node audit-log-verify.mjs   （需后端 :8080 在跑）
const BASE = 'http://localhost:8080/api'
const j = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
  })
  const data = await r.json().catch(() => null)
  return { status: r.status, code: data?.code, data: data?.data, raw: data }
}
const jget = (p, t) => j('GET', p, null, t)
const jpost = (p, b, t) => j('POST', p, b, t)
const jput = (p, b, t) => j('PUT', p, b, t)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra) }
}

async function loginOrRegister(username, password, nickname) {
  // 登录/注册返回的都是 { token, user:{...} }，这里拍平成 { token, id, nickname, user }
  // （直接用 data.id 会得到 undefined → 拼出 /admin/users/undefined/... → 400，极难排查）
  const asUser = (d) => (d && d.token ? { ...d, id: d.user?.id, nickname: d.user?.nickname, user: d.user } : null)
  let r = await jpost('/auth/login', { username, password })
  if (r.code === 200 && r.data?.token) return asUser(r.data)
  r = await jpost('/auth/register', { username, password, nickname: nickname || username })
  if (r.code === 200 && r.data?.token) return asUser(r.data)
  throw new Error('login/register failed: ' + JSON.stringify(r.raw))
}

const today = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function main() {
  const stamp = Date.now().toString().slice(-6)

  console.log('[1] 权限边界')
  const anon = await jget('/admin/audit-logs')
  check('匿名访问被拒（401/403）', anon.code === 401 || anon.code === 403, 'code=' + anon.code)

  const admin = await loginOrRegister('admin', 'admin123456')
  const adminToken = admin.token
  check('管理员登录成功', !!adminToken, JSON.stringify(admin).slice(0, 120))

  const normalName = 'audu_' + stamp
  const normal = await loginOrRegister(normalName, 'pwd123456', normalName)
  const normalToken = normal.token
  const denied = await jget('/admin/audit-logs', normalToken)
  check('普通用户访问被拒（403）', denied.code === 403, 'code=' + denied.code)

  const okPage = await jget('/admin/audit-logs?current=1&size=5', adminToken)
  check('管理员可读（200）', okPage.code === 200, 'code=' + okPage.code)
  check('返回分页结构', okPage.data && Array.isArray(okPage.data.records) && typeof okPage.data.total === 'number')

  console.log('[2] 动作码字典')
  const dict = await jget('/admin/audit-logs/actions', adminToken)
  check('字典接口 200', dict.code === 200)
  const codes = (dict.data || []).map((x) => x.code)
  check('包含核心动作码', ['POST_HIDE', 'USER_BAN', 'REPORT_HANDLE', 'USER_ROLE_UPDATE'].every((c) => codes.includes(c)),
        'codes=' + codes.slice(0, 8).join(','))
  check('全部动作都有中文标签', (dict.data || []).every((x) => x.label && x.label !== x.code))

  console.log('[3] 触发真实动作 → 审计落库')
  // 3.1 对一次性测试用户重复设置其现有角色（零业务副作用，但会留痕）
  const roleRes = await jput(`/admin/users/${normal.id}/roles`, { roles: ['USER'] }, adminToken)
  check('改角色接口成功', roleRes.code === 200, 'code=' + roleRes.code)

  // 3.2 对现有帖子连续置顶两次（净效果回到原状，避免污染演示数据）
  const posts = await jget('/posts?current=1&size=1', adminToken)
  const postId = posts.data?.records?.[0]?.id
  check('取到一条用于测试的帖子', !!postId)
  const pin1 = await jpost(`/admin/posts/${postId}/pin`, null, adminToken)
  const pin2 = await jpost(`/admin/posts/${postId}/pin`, null, adminToken)
  check('置顶切换两次均成功', pin1.code === 200 && pin2.code === 200)

  const roleLogs = await jget(`/admin/audit-logs?action=USER_ROLE_UPDATE&size=20`, adminToken)
  const mine = (roleLogs.data?.records || []).find((r) => r.targetId === normal.id)
  check('查到 USER_ROLE_UPDATE 记录', !!mine, JSON.stringify(roleLogs.data?.records?.[0] || {}).slice(0, 160))
  if (mine) {
    check('操作人 ID 正确', mine.operatorId === admin.user?.id, 'operatorId=' + mine.operatorId)
    check('操作人昵称快照非空', !!mine.operatorName, 'name=' + mine.operatorName)
    check('中文标签正确', mine.actionLabel === '修改用户角色', 'label=' + mine.actionLabel)
    check('对象类型=USER 且 ID 正确', mine.targetType === 'USER' && mine.targetId === normal.id)
    check('记录来源 IP', !!mine.ip, 'ip=' + mine.ip)
  }

  const pinLogs = await jget(`/admin/audit-logs?targetType=POST&size=10`, adminToken)
  const pinRecs = (pinLogs.data?.records || []).filter((r) => r.targetId === postId)
  const pinCodes = pinRecs.map((r) => r.action)
  check('连续两次置顶 → 同时留下 置顶/取消置顶 两条', pinCodes.includes('POST_PIN') && pinCodes.includes('POST_UNPIN'),
        'codes=' + pinCodes.join(','))
  check('对象类型筛选只返回 POST', (pinLogs.data?.records || []).every((r) => r.targetType === 'POST'))

  console.log('[4] 筛选')
  const byId = await jget(`/admin/audit-logs?operator=${admin.user?.id}&size=5`, adminToken)
  check('按操作人 ID 筛选命中', byId.code === 200 && (byId.data?.records || []).length > 0,
        'total=' + byId.data?.total)
  check('筛选结果操作人均为该 ID', (byId.data?.records || []).every((r) => r.operatorId === admin.user?.id))

  const ghost = await jget(`/admin/audit-logs?operator=__no_such_operator__${stamp}`, adminToken)
  check('不存在的操作人 → 0 条', ghost.data?.total === 0, 'total=' + ghost.data?.total)

  const fromToday = await jget(`/admin/audit-logs?from=${today()}&size=5`, adminToken)
  check('起始时间=今天 → 有记录（验证只传日期的补全逻辑）', fromToday.code === 200 && fromToday.data?.total > 0,
        'total=' + fromToday.data?.total)

  const fromFuture = await jget('/admin/audit-logs?from=2099-01-01', adminToken)
  check('起始时间=2099 → 0 条', fromFuture.data?.total === 0, 'total=' + fromFuture.data?.total)

  const toOld = await jget('/admin/audit-logs?to=2000-01-01', adminToken)
  check('截止时间=2000 → 0 条', toOld.data?.total === 0, 'total=' + toOld.data?.total)

  console.log('[5] 分页契约')
  const p2 = await jget('/admin/audit-logs?current=1&size=2', adminToken)
  check('size 生效', p2.data?.size === 2 && (p2.data?.records || []).length <= 2, 'size=' + p2.data?.size)
  check('time 倒序', (() => {
    const rs = p2.data?.records || []
    for (let i = 1; i < rs.length; i++) if (rs[i - 1].createdAt < rs[i].createdAt) return false
    return true
  })())
  const pFar = await jget('/admin/audit-logs?current=9999&size=2', adminToken)
  check('超范围页码 → 空记录不报错', pFar.code === 200 && (pFar.data?.records || []).length === 0)

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => { console.error('脚本异常：', e); process.exitCode = 1 })
