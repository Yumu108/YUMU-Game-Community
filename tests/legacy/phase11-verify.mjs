// Phase 11 验证：分层级审核 + 驳回通知 + 子板块无子板主上溯父版主
// 用法：node phase11-verify.mjs
const BASE = 'http://localhost:8080/api'

let pass = 0, fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗ FAIL:', msg) }
}
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const j = await r.json().catch(() => ({}))
  return { http: r.status, code: j.code, data: j.data, msg: j.message, raw: j }
}
const jget = (p, t) => j('GET', p, null, t)
const jpost = (p, b, t) => j('POST', p, b, t)
const jput = (p, b, t) => j('PUT', p, b, t)
const jdel = (p, t) => j('DELETE', p, null, t)

const suffix = Date.now().toString(36).slice(-6)
let A = '', U = '', M = '', MS = ''
let user = {}, modBig = {}, modSub = {}

async function main() {
  console.log('═══ Phase 11 分层级审核验证 ═══\n')

  // ---------- 0. 准备 ----------
  console.log('[0] 准备账号')
  const login = await jpost('/auth/login', { username: 'admin', password: 'admin123456' })
  A = login.data?.token
  const rU = await jpost('/auth/register', { username: `p11u_${suffix}`, password: 'pass123456', nickname: 'P11普通用户' })
  U = rU.data?.token; user = rU.data?.user
  const rM1 = await jpost('/auth/register', { username: `p11big_${suffix}`, password: 'pass123456', nickname: 'P11大版主' })
  const rM2 = await jpost('/auth/register', { username: `p11sub_${suffix}`, password: 'pass123456', nickname: 'P11小板主' })
  M = rM1.data?.token; modBig = rM1.data?.user
  MS = rM2.data?.token; modSub = rM2.data?.user
  assert(!!A && !!U && !!M && !!MS, `登录 / 注册 4 个账号成功`)

  // 找父 + 子 板块
  const tree = await jget('/boards')
  const parent = (tree.data || []).find((p) => (p.children || []).length)
  const child = parent.children[0]
  const parentId = parent.id
  const childId = child.id
  assert(!!parent && !!child, `找到父板块 ${parent.name} / 子板块 ${child.name}`)

  // 为这次验证创建一个新的子板块（确保无历史小板主 / 子板主）
  const subBoard = await jpost('/admin/boards', { name: `P11 子${suffix}`, icon: '🎮', parentId, sort: 999 }, A)
  assert(subBoard.code === 200 && subBoard.data?.id, `新建子板块 #${subBoard.data?.id} 用于测试`)
  const newChildId = subBoard.data?.id

  // 把 u1 设为大版主（负责父板块 + 整个子板块链），通过负责新创建的子板块的板块 id 列表（含父板块+新建子）
  // 为体现"大版主管多个"，给大版主分配父板块 + 新建子板块
  await jput(`/admin/users/${modBig.id}/roles`, { roles: ['MODERATOR'] }, A)
  const setBig = await jput(`/admin/users/${modBig.id}/moderator-boards`, { boardIds: [parentId, newChildId] }, A)
  assert(setBig.code === 200, `大版主分配父+新子板块`)

  // 小板主只负责新建子板块
  await jput(`/admin/users/${modSub.id}/roles`, { roles: ['MODERATOR'] }, A)
  const setSub = await jput(`/admin/users/${modSub.id}/moderator-boards`, { boardIds: [newChildId] }, A)
  assert(setSub.code === 200, `小板主分配新子板块`)

  // 切换 admin / 大版主 / 小板主 各看一次 badge
  const meAdmin = await jget('/auth/me', A)
  const meBig = await jget('/auth/me', M)
  const meSub = await jget('/auth/me', MS)
  console.log('  i admin badge =', meAdmin.data?.badge, 'big =', meBig.data?.badge, 'sub =', meSub.data?.badge)
  // 大版主/小板主此时已经被分配了 MODERATOR 角色 + 负责板块，再查一次确认
  const meBig2 = await jget('/auth/me', M)
  const meSub2 = await jget('/auth/me', MS)
  console.log('  i big2 roles =', JSON.stringify(meBig2.data?.roles), 'sub2 roles =', JSON.stringify(meSub2.data?.roles), 'big2 badge =', meBig2.data?.badge, 'sub2 badge =', meSub2.data?.badge)

  // 辅助：拿后端真实 status（管理接口，绕过 status=0 过滤）
  const adminDetail = (id) => jget(`/admin/posts/${id}/detail`, A)

  // ---------- 1. 普通用户发帖 → status=2 待审 ----------
  console.log('\n[1] 普通用户发帖 → 待审核')
  const p1 = await jpost('/posts', { title: 'P11 普通用户帖', content: '<p>用户帖正文</p>', boardId: newChildId }, U)
  assert(p1.code === 200 && p1.data?.id, `普通用户发帖成功 #${p1.data?.id}`)
  const detail1 = await adminDetail(p1.data?.id)
  assert(detail1.data?.status === 2, `普通用户帖 status=2 待审 (实际 ${detail1.data?.status})`)
  // 公开用户视角: status=2 仍 404
  const pub = await jget(`/posts/${p1.data?.id}`, U)
  assert(pub.code === 404, `公开接口访问待审核帖 404`)

  // ---------- 2. 大版主发帖 → 待审，需 ADMIN 通过 ----------
  console.log('\n[2] 大版主发帖 → 待 ADMIN 审')
  const p2 = await jpost('/posts', { title: 'P11 大版主帖', content: '<p>大版主正文</p>', boardId: newChildId }, M)
  assert(p2.code === 200 && p2.data?.id, `大版主发帖成功 #${p2.data?.id}`)
  const detail2 = await adminDetail(p2.data?.id)
  assert(detail2.data?.status === 2, `大版主帖 status=2 (实际 ${detail2.data?.status})`)

  // ---------- 3. ADMIN 发帖 → 直接 0 ----------
  console.log('\n[3] ADMIN 发帖 → 直接发布')
  const p3 = await jpost('/posts', { title: 'P11 admin 帖', content: '<p>admin 正文</p>', boardId: newChildId }, A)
  const detail3 = await jget(`/posts/${p3.data?.id}`, U)
  assert(detail3.code === 200 && detail3.data?.status === 0, `admin 帖 status=0 直接可见`)

  // ---------- 4. 小板主发帖 → 待审 ----------
  console.log('\n[4] 小板主发帖 → 待 大版主 审')
  const p4 = await jpost('/posts', { title: 'P11 小板主帖', content: '<p>小板主正文</p>', boardId: newChildId }, MS)
  const detail4 = await adminDetail(p4.data?.id)
  assert(detail4.data?.status === 2, `小板主帖 status=2 (实际 ${detail4.data?.status})`)

  // ---------- 5. 审核权限校验 ----------
  console.log('\n[5] canReviewPost 权限校验')
  // 对 p1（普通用户帖，在 newChildId）：
  const r_admin = await jget(`/admin/posts/${p1.data?.id}/can-review`, A)
  assert(r_admin.data?.canReview === true, `admin 可审普通用户帖`)
  const r_big = await jget(`/admin/posts/${p1.data?.id}/can-review`, M)
  assert(r_big.data?.canReview === true, `大版主 可审自己负责板块内的普通用户帖 (实际 ${r_big.data?.canReview})`)
  const r_sub = await jget(`/admin/posts/${p1.data?.id}/can-review`, MS)
  // 小板主负责该子板块，应也能审该子板块内的普通用户帖
  assert(r_sub.data?.canReview === true, `小板主 可审自己负责板块内的普通用户帖 (实际 ${r_sub.data?.canReview})`)

  // 对 p2（大版主帖）：仅 admin 可审，大版主自己不能审
  const r2_admin = await jget(`/admin/posts/${p2.data?.id}/can-review`, A)
  assert(r2_admin.data?.canReview === true, `admin 可审大版主帖 (实际 ${r2_admin.data?.canReview})`)
  const r2_big = await jget(`/admin/posts/${p2.data?.id}/can-review`, M)
  assert(r2_big.data?.canReview === false, `大版主 不能审自己的帖 (实际 ${r2_big.data?.canReview})`)
  const r2_sub = await jget(`/admin/posts/${p2.data?.id}/can-review`, MS)
  // 小板主对大版主帖：同级（都是 MODERATOR 但提交人是更高级别）应 false
  assert(r2_sub.data?.canReview === false, `小板主 不能审大版主帖（同为 MODERATOR 不足） (实际 ${r2_sub.data?.canReview})`)

  // 对 p4（小板主帖）：需大版主审
  const r4_big = await jget(`/admin/posts/${p4.data?.id}/can-review`, M)
  assert(r4_big.data?.canReview === true, `大版主 可审小板主帖 (实际 ${r4_big.data?.canReview})`)
  const r4_sub = await jget(`/admin/posts/${p4.data?.id}/can-review`, MS)
  assert(r4_sub.data?.canReview === false, `小板主 不能审自己的帖 (实际 ${r4_sub.data?.canReview})`)

  // 普通用户 不能审（无 /admin/** 访问权 → 403）
  const r_user = await jget(`/admin/posts/${p1.data?.id}/can-review`, U)
  assert(r_user.code === 403, `普通用户 无审核权（403，实际 ${r_user.code}）`)

  // ---------- 6. 驳回 ----------
  console.log('\n[6] 驳回流程')
  // 大版主驳回普通用户帖
  const rej = await jpost(`/admin/posts/${p1.data?.id}/reject`, { reason: '广告内容' }, M)
  assert(rej.code === 200, `大版主 驳回普通用户帖 200 (实际 ${rej.code})`)
  const detail1After = await adminDetail(p1.data?.id)
  assert(detail1After.data?.status === 1, `驳回后 status=1 (实际 ${detail1After.data?.status})`)
  assert(detail1After.data?.rejectReason === '广告内容', `驳回理由写入数据库`)
  // 公开应 404
  const pub1After = await jget(`/posts/${p1.data?.id}`, U)
  assert(pub1After.code === 404, `驳回后公开访问 404`)

  // 普通用户不能驳回
  const rej403 = await jpost(`/admin/posts/${p2.data?.id}/reject`, { reason: '坏人' }, U)
  assert(rej403.code === 403, `普通用户驳回被 403`)

  // 同级不应能审（小板主审同板块普通用户可以，但审小板主自己帖不行；这里测 大版主审 admin 帖）
  // 临时构造：用普通用户审 admin 帖
  const rejAdminToUser = await jpost(`/admin/posts/${p3.data?.id}/reject`, { reason: 'no' }, U)
  assert(rejAdminToUser.code === 403, `普通用户 驳回 admin 帖 403`)

  // ---------- 7. approve 流 ----------
  console.log('\n[7] approve 流')
  // admin 通过 p2（大版主帖）
  const app2 = await jpost(`/admin/posts/${p2.data?.id}/approve`, null, A)
  assert(app2.code === 200, `admin 通过大版主帖 (实际 ${app2.code})`)
  const detail2After = await jget(`/posts/${p2.data?.id}`, U)
  assert(detail2After.code === 200 && detail2After.data?.status === 0, `通过后公开可见 (code=${detail2After.code}, status=${detail2After.data?.status})`)

  // 大版主 通过 p4（小板主帖）
  const app4 = await jpost(`/admin/posts/${p4.data?.id}/approve`, null, M)
  assert(app4.code === 200, `大版主 通过小板主帖 (实际 ${app4.code})`)
  const detail4After = await jget(`/posts/${p4.data?.id}`, U)
  assert(detail4After.code === 200 && detail4After.data?.status === 0, `通过后公开可见`)

  // ---------- 8. 驳回通知 ----------
  console.log('\n[8] 驳回通知')
  // 看 user 收到一条 notification (type=5=审核通知, target_type=1=帖子)
  // /notifications 返回数组
  const notifs = await jget(`/notifications`, U)
  assert(notifs.code === 200, `用户通知列表 200`)
  const hasReject = (notifs.data || []).some((n) => n.type === 5 && n.targetId === p1.data?.id)
  assert(hasReject, `用户收到驳回通知（type=5, targetId=${p1.data?.id}）`)

  // ---------- 9. 子板块无子板主上溯父版主 ----------
  console.log('\n[9] 子板块无子板主，上溯父版主')
  // 创建一个新的子板块，给大版主分配父板块但不分配新建子板块
  const sb2 = await jpost('/admin/boards', { name: `P11 子2 ${suffix}`, icon: '🎯', parentId, sort: 998 }, A)
  const newChild2Id = sb2.data?.id
  // 把大版主重新设置为仅负责父板块（不负责新建子板块2）
  await jput(`/admin/users/${modBig.id}/moderator-boards`, { boardIds: [parentId] }, A)
  // 普通用户在子板块2发帖
  const p9 = await jpost('/posts', { title: 'P11 子2 普通帖', content: '<p>内容</p>', boardId: newChild2Id }, U)
  // 大版主子板块2无直接负责，但能通过父版主上溯审
  const r9_big = await jget(`/admin/posts/${p9.data?.id}/can-review`, M)
  assert(r9_big.data?.canReview === true, `大版主能通过父版主上溯审子板块2（实际 ${r9_big.data?.canReview}）`)
  const r9_sub = await jget(`/admin/posts/${p9.data?.id}/can-review`, MS)
  assert(r9_sub.data?.canReview === false, `小板主（管新子1，没管父）不能审子板块2（实际 ${r9_sub.data?.canReview}）`)

  // ---------- 10. 收尾清理 ----------
  console.log('\n[10] 清理（恢复 user 角色）')
  await jput(`/admin/users/${modBig.id}/roles`, { roles: ['USER'] }, A)
  await jput(`/admin/users/${modSub.id}/roles`, { roles: ['USER'] }, A)
  await jdel(`/admin/boards/${newChildId}`, A)
  await jdel(`/admin/boards/${newChild2Id}`, A)

  console.log(`\n═══ Phase 11 验证：${pass} passed, ${fail} failed ═══`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('UNCAUGHT', e); process.exit(1) })
