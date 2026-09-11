// 用法：node tests/reject-resubmit-verify.mjs
// 验证（2026-09-03 新功能）：
//   1) 普通用户发帖 → status=2 待审核，作者可见详情
//   2) 待审帖不能"隐藏"（防 2→1→0 绕审）
//   3) admin 驳回 → status=1 + rejectReason；作者详情可见驳回理由
//   4) 被驳回帖不能直接"恢复可见"（防绕过审核）
//   5) 作者重新编辑保存 → 自动回到待审(resubmitted=true)，驳回理由清空
//   6) 他人不可见驳回/待审帖；admin 批准后 status=0 所有人可见
//   7) 对照组：正常已发布帖 隐藏→恢复 不受影响
// 结尾自动清理测试帖（不污染演示数据）
const BASE = process.env.YUMU_HOST || 'http://localhost:8080/api'
const rnd = () => 'rrs' + Date.now().toString(36) + Math.floor(Math.random() * 100000)

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (data && typeof data === 'object') return { status: res.status, ...data }
  return { status: res.status, data }
}
async function login(u, p) {
  const r = await jfetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
  if (r.code !== 200) throw new Error(`login fail: ${r.message}`)
  return r.data.token
}
async function register(username) {
  const r = await jfetch('/auth/register', { method: 'POST', body: JSON.stringify({ username, password: 'pass123456', nickname: '驳回重提测试' }) })
  if (r.code !== 200) throw new Error(`register fail: ${r.message}`)
  return login(username, 'pass123456')
}

let passed = 0, failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label) }
  else { failed++; console.log('  ✗ ' + label) }
}

async function main() {
  let adminTok = null, pid = null, pid2 = null
  try {
    console.log('═'.repeat(62))
    console.log('驳回 → 重新编辑提审 全链路验证')
    console.log('═'.repeat(62))

    adminTok = await login('admin', (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME'))
    const adminAuth = { Authorization: `Bearer ${adminTok}` }
    const name = rnd()
    const authorTok = await register(name)
    const authorAuth = { Authorization: `Bearer ${authorTok}` }
    assert(!!authorTok, `注册一次性作者 ${name}`)

    const title1 = '驳回重提测试-' + name
    const post = await jfetch('/posts', {
      method: 'POST', headers: authorAuth,
      body: JSON.stringify({ boardId: 1, gameId: 2, title: title1, content: '这是待审核的正文内容', tags: ['测试'] })
    })
    pid = post.data?.id
    assert(post.code === 200 && pid, `作者发帖 id=${pid}（普通用户应进待审）`)

    const detail = async (auth) => (await jfetch(`/posts/${pid}`, { headers: auth })).data

    console.log('\n[1] 发帖后状态 = 待审核(2)')
    let d = await detail(authorAuth)
    assert(d && d.status === 2, `作者详情 status=${d?.status}（期望 2）`)

    console.log('\n[2] 待审帖不能先隐藏（防 2→1→0 绕审）')
    const hidePending = await jfetch(`/posts/${pid}/hide`, { method: 'POST', headers: authorAuth })
    assert(hidePending.code === 400, `隐藏待审帖被拒 code=${hidePending.code}`)

    console.log('\n[3] admin 驳回：status=1 + rejectReason')
    const reject = await jfetch(`/admin/posts/${pid}/reject`, {
      method: 'POST', headers: adminAuth, body: JSON.stringify({ reason: '内容不够详细，请补充说明后重新提交' })
    })
    assert(reject.code === 200, `admin 驳回成功`)
    d = await detail(authorAuth)
    assert(d && d.status === 1 && !!d.rejectReason, `作者详情可见驳回：status=${d?.status}, reason=${(d?.rejectReason || '').slice(0, 20)}`)

    console.log('\n[4] 被驳回帖不能直接恢复可见（防绕过审核）')
    const restoreRejected = await jfetch(`/posts/${pid}/restore`, { method: 'POST', headers: authorAuth })
    assert(restoreRejected.code === 400, `恢复被驳回帖被拒 code=${restoreRejected.code}`)

    console.log('\n[5] 作者重新编辑保存 → 自动重新提审（status=2, 清空驳回理由）')
    const edit = await jfetch(`/posts/${pid}`, {
      method: 'PUT', headers: authorAuth,
      body: JSON.stringify({ boardId: 1, gameId: 2, title: title1, content: '补充细节后的正文内容：机制说明、配装与演示', tags: ['测试', '攻略'] })
    })
    assert(edit.code === 200 && edit.data?.resubmitted === true, `保存返回 resubmitted=${edit.data?.resubmitted}`)
    d = await detail(authorAuth)
    assert(d && d.status === 2 && !d.rejectReason, `重提后 status=${d?.status}，rejectReason=${d?.rejectReason || '(空)'}`)

    console.log('\n[5.5] 待重审标记：resubmitAt 写入并对审核后台可见')
    assert(d && !!d.resubmitAt, `作者详情 resubmitAt=${d?.resubmitAt || '(空)'}`)
    const adminList = await jfetch(`/admin/posts?status=2&current=1&size=50`, { headers: adminAuth })
    const row = (adminList.data?.records || []).find(x => x.id === pid)
    assert(row && !!row.resubmitAt, `审核后台待审列表 resubmitAt=${row ? row.resubmitAt || '(空)' : '(未找到帖子)'}`)

    console.log('\n[6] 他人看不到驳回/待审帖（404），admin 批准后可见')
    const stranger = await register(rnd())
    const other = await jfetch(`/posts/${pid}`, { headers: { Authorization: `Bearer ${stranger}` } })
    assert(other.code === 404, `他人访问待审帖 → code=404`)
    const approve = await jfetch(`/admin/posts/${pid}/approve`, { method: 'POST', headers: adminAuth })
    assert(approve.code === 200, `admin 批准通过`)
    d = await detail(authorAuth)
    assert(d && d.status === 0 && !d.resubmitAt, `批准后 status=${d?.status}，resubmitAt=${d?.resubmitAt || '(已清空)'}`)

    console.log('\n[7] 对照组：正常可见帖 隐藏→恢复 不受影响')
    const post2 = await jfetch('/posts', {
      method: 'POST', headers: authorAuth,
      body: JSON.stringify({ boardId: 2, gameId: 3, title: '对照组隐藏恢复-' + name, content: '对照组正文' })
    })
    pid2 = post2.data?.id
    await jfetch(`/admin/posts/${pid2}/approve`, { method: 'POST', headers: adminAuth }) // 先让它可见
    const h1 = await jfetch(`/posts/${pid2}/hide`, { method: 'POST', headers: authorAuth })
    assert(h1.code === 200, `已发布帖可隐藏`)
    const r1 = await jfetch(`/posts/${pid2}/restore`, { method: 'POST', headers: authorAuth })
    assert(r1.code === 200, `自隐藏帖可正常恢复（无驳回理由不受拦截）`)
    const d2 = await detail(authorAuth)
    assert(d2 && d2.status === 0, `恢复后 status=${d2?.status}`)
  } finally {
    // 自动清理本脚本创建的测试帖，避免污染演示数据
    if (adminTok) {
      const adminAuth = { Authorization: `Bearer ${adminTok}` }
      for (const id of [pid, pid2]) {
        if (id) await jfetch(`/posts/${id}`, { method: 'DELETE', headers: adminAuth })
      }
      console.log('─'.repeat(62))
      console.log('🧹 已自动清理本脚本创建的测试帖')
    }
  }
  console.log(`结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
