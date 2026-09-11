// 9-08 v2 待审核 / 隐藏帖的互动边界验证（作者本人也只读）：
//   A. 作者本人：非公开帖（status=1/2）点赞 / 收藏 / 举报 / 回帖 全部 403，只读
//   B. 他人：帖子不可见 → 点赞 / 收藏 / 举报 / 回帖 全部 403（防越权 + 防刷举报）
//   C. 管理员 / 版主：待审核帖可预览（此前 404 死链已修），但互动同样 403
//   D. 已隐藏帖：作者本人也不可互动（status=1 一视同仁）
//   E. 审核通过后一切恢复正常，且 like_count 未被越权污染
// 运行：cd tests && node pending-post-interaction-verify.mjs（需后端 8080 在跑）
const BASE = 'http://localhost:8080/api'

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')) }
}

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  return res.json().catch(() => ({}))
}

const TS = Date.now()
const PWD = 'pwd123456'
async function register(u, n) {
  await api('POST', '/auth/register', null, { username: u, password: PWD, nickname: n })
  const l = await api('POST', '/auth/login', null, { username: u, password: PWD })
  return l.data.token
}

console.log('[准备] 账号与板块')
const tAuthor = await register('pia' + TS, '作者号')
const tOther = await register('pio' + TS, '路人号')
const admin = await api('POST', '/auth/login', null, { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') })
const tAdmin = admin.data.token
const boards = await api('GET', '/boards', tAuthor)
const boardId = boards.data[0].id
const mk = (title) => api('POST', '/posts', tAuthor, { title, content: '互动边界验证内容：' + title, boardId })
const adminDetail = (id) => api('GET', `/admin/posts/${id}/detail`, tAdmin)

// ============ A. 待审核帖（status=2）：作者本人 ============
console.log('\n[A] 待审核帖 · 作者本人（v2：一律只读）')
const pA = (await mk('互动边界-待审 ' + TS)).data?.id
const dSelf = await api('GET', `/posts/${pA}`, tAuthor)
check('作者可打开自己的待审帖', dSelf.code === 200 && dSelf.data?.status === 2, JSON.stringify(dSelf).slice(0, 120))

const lSelf = await api('POST', `/posts/${pA}/like`, tAuthor)
check('作者点赞自己的待审帖被拦（403）',
  lSelf.code === 403 && /审核中/.test(lSelf.message || ''),
  `${lSelf.code} ${lSelf.message}`)

const fSelf = await api('POST', `/posts/${pA}/favorite`, tAuthor)
check('作者收藏自己的待审帖被拦（403）',
  fSelf.code === 403 && /审核中/.test(fSelf.message || ''),
  `${fSelf.code} ${fSelf.message}`)

const rSelf = await api('POST', '/reports', tAuthor, { targetType: 1, targetId: pA, reason: '自检举报' })
check('作者举报自己的待审帖被拦（403）',
  rSelf.code === 403 && /审核中/.test(rSelf.message || ''),
  `${rSelf.code} ${rSelf.message}`)

const repSelf = await api('POST', `/posts/${pA}/replies`, tAuthor, { content: '作者给自己待审帖补充一句' })
check('作者回帖被拦且给出可读原因',
  repSelf.code === 403 && /审核中/.test(repSelf.message || ''),
  `${repSelf.code} ${repSelf.message}`)

// ============ B. 待审核帖：他人 ============
console.log('\n[B] 待审核帖 · 他人（不可见 → 互动全部拒绝）')
const dOther = await api('GET', `/posts/${pA}`, tOther)
check('他人打开待审帖仍是 404', dOther.code === 404, dOther.message)

const lOther = await api('POST', `/posts/${pA}/like`, tOther)
check('他人点赞被拒绝（403）',
  lOther.code === 403 && /审核中/.test(lOther.message || ''),
  `${lOther.code} ${lOther.message}`)

const fOther = await api('POST', `/posts/${pA}/favorite`, tOther)
check('他人收藏被拒绝（403）', fOther.code === 403, `${fOther.code} ${fOther.message}`)

const repOther = await api('POST', `/posts/${pA}/replies`, tOther, { content: '路人回帖' })
check('他人回帖被拒绝且给出可读原因',
  repOther.code === 403 && /审核中/.test(repOther.message || ''),
  `${repOther.code} ${repOther.message}`)

const rOther = await api('POST', '/reports', tOther, { targetType: 1, targetId: pA, reason: '他人举报待审帖' })
check('他人举报也拒绝（v2：审核期间不接收任何举报）',
  rOther.code === 403 && /审核中/.test(rOther.message || ''),
  `${rOther.code} ${rOther.message}`)

// ============ C. 管理员预览待审帖（修复死链 + 互动同样锁） ============
console.log('\n[C] 待审核帖 · 管理员预览（只读）')
const dAdm = await api('GET', `/posts/${pA}`, tAdmin)
check('管理员可预览待审帖（此前 404 死链）',
  dAdm.code === 200 && dAdm.data?.previewOnly === true,
  `${dAdm.code} previewOnly=${dAdm.data?.previewOnly}`)
const before1 = (await adminDetail(pA)).data?.viewCount
await api('GET', `/posts/${pA}`, tAdmin)
const after1 = (await adminDetail(pA)).data?.viewCount
check('预览不计入浏览量', before1 === after1, `${before1} → ${after1}`)
check('管理员预览时 data.status 仍为 2', dAdm.data?.status === 2)

const lAdm = await api('POST', `/posts/${pA}/like`, tAdmin)
check('管理员预览时也不能点赞', lAdm.code === 403, `${lAdm.code} ${lAdm.message}`)

// ============ D. 隐藏帖（status=1）同样的边界 ============
console.log('\n[D] 已隐藏帖 · 一视同仁')
const pH = (await mk('互动边界-隐藏 ' + TS)).data?.id
await api('POST', `/admin/posts/${pH}/approve`, tAdmin)
await api('POST', `/posts/${pH}/hide`, tAuthor)
const stH = (await adminDetail(pH)).data?.status
check('帖子已变为隐藏态 status=1', stH === 1, String(stH))

const lH = await api('POST', `/posts/${pH}/like`, tOther)
check('他人不能给隐藏帖点赞', lH.code === 403, `${lH.code} ${lH.message}`)
const fH = await api('POST', `/posts/${pH}/favorite`, tOther)
check('他人不能收藏隐藏帖', fH.code === 403, `${fH.code} ${fH.message}`)
const repH = await api('POST', `/posts/${pH}/replies`, tOther, { content: '给隐藏帖回帖' })
check('他人不能给隐藏帖回帖', repH.code === 403, `${repH.code} ${repH.message}`)
const rH = await api('POST', '/reports', tOther, { targetType: 1, targetId: pH, reason: '举报隐藏帖' })
check('他人不能举报隐藏帖（v2）', rH.code === 403, `${rH.code} ${rH.message}`)

const lHSelf = await api('POST', `/posts/${pH}/like`, tAuthor)
check('作者本人也不能给隐藏帖点赞（v2：一视同仁）',
  lHSelf.code === 403, `${lHSelf.code} ${lHSelf.message}`)
const dAdmH = await api('GET', `/posts/${pH}`, tAdmin)
check('管理员可预览隐藏帖（回归）', dAdmH.code === 200 && dAdmH.data?.previewOnly === true)

// ============ E. 审核通过后一切正常 + 数据干净 ============
console.log('\n[E] 审核通过后回归 + 数据干净')
const baseLike = (await adminDetail(pA)).data?.likeCount
await api('POST', `/admin/posts/${pA}/approve`, tAdmin)
const stAfter = (await adminDetail(pA)).data?.status
check('审核通过 → status=0', stAfter === 0, String(stAfter))
const likeAfterApprove = (await adminDetail(pA)).data?.likeCount
check('点赞数未被越权污染（应仍为 0，审核期间无任何点赞可写）',
  likeAfterApprove === baseLike && likeAfterApprove === 0,
  `通过前=${baseLike} 通过后=${likeAfterApprove}`)

const lPub = await api('POST', `/posts/${pA}/like`, tOther)
check('发布后他人可点赞', lPub.code === 200 && lPub.data?.liked === true, lPub.message)
const fPub = await api('POST', `/posts/${pA}/favorite`, tOther)
check('发布后他人可收藏', fPub.code === 200 && fPub.data?.favorited === true, fPub.message)
const repPub = await api('POST', `/posts/${pA}/replies`, tOther, { content: '发布后来补个评论' })
check('发布后他人可回帖', repPub.code === 200, `${repPub.code} ${repPub.message}`)
const lPubSelf = await api('POST', `/posts/${pA}/like`, tAuthor)
check('发布后作者本人也可点赞（v2：审核通过即解封）',
  lPubSelf.code === 200 && lPubSelf.data?.liked === true, lPubSelf.message)

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
console.log('待清理 postId:', pA, pH)
process.exit(failed ? 1 : 0)
