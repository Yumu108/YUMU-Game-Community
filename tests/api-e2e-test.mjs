// YUMU 游戏社区 · 后端接口端到端回归测试
// 运行：node api-e2e-test.mjs
// 依赖：本机后端已在 http://localhost:8080/api 运行（JDK21 + MySQL8 yumu_community）
// 覆盖：鉴权/未授权/校验、板块、帖子(列表/详情/发帖/点赞/收藏/标签)、回帖楼中楼、
//       关注、标签、搜索、统计、用户主页、私信、通知；含越权与非法输入用例。
import crypto from 'node:crypto'

const BASE = 'http://localhost:8080/api'
let pass = 0, fail = 0
const fails = []
const T = (n) => console.log(`\n=== ${n} ===`)

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; fails.push(name + (extra ? ` → ${extra}` : '')); console.error(`  ❌ ${name}${extra ? ' → ' + extra : ''}`) }
}
function checkCode(name, resp, code) {
  const got = resp.json && resp.json.code
  check(name, resp.status === 200 && got === code, `http=${resp.status} code=${got}`)
}
function checkStatus(name, resp, status) {
  check(name, resp.status === status, `http=${resp.status}`)
}

async function call(method, path, { token, body, query } = {}) {
  let url = BASE + path
  if (query) url += '?' + new URLSearchParams(query)
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  let json = null
  try { json = await res.json() } catch { /* 401 无 body */ }
  return { status: res.status, json }
}

const uniq = (p) => `${p}_${crypto.randomBytes(4).toString('hex')}`

async function main() {
  // ---------- 0. 基础健康 ----------
  T('0. 基础联通')
  const boards = await call('GET', '/boards')
  checkCode('GET /boards 200 且返回板块树', boards, 200)
  const top = boards.json?.data || []
  check('板块树存在顶层板块', Array.isArray(top) && top.length > 0)
  const leaf = (top[0]?.children?.[0]?.id) || top[0]?.id
  check('取到可用板块 id', typeof leaf === 'number', `leaf=${leaf}`)

  const posts = await call('GET', '/posts', { query: { sort: 'latest', current: 1, size: 5 } })
  checkCode('GET /posts 列表 200', posts, 200)
  check('帖子列表 records ≤ size', (posts.json?.data?.records?.length || 0) <= 5)

  // ---------- 1. 未授权 / 校验 ----------
  T('1. 未授权与参数校验')
  const meUnauth = await call('GET', '/auth/me')
  checkCode('未登录 GET /auth/me → code 401(控制器兜底, 不会 500)', meUnauth, 401)
  const createUnauth = await call('POST', '/posts', { body: { title: 'x', boardId: leaf, content: 'x' } })
  checkStatus('未登录 POST /posts → HTTP 401(Security 拦截)', createUnauth, 401)
  const tagsUnauth = await call('PUT', `/posts/${leaf}/tags`, { body: { tags: ['a'] } })
  checkStatus('未登录 PUT /posts/{id}/tags → HTTP 401', tagsUnauth, 401)

  const regShort = await call('POST', '/auth/register', { body: { username: uniq('u'), password: '123', nickname: 'x' } })
  checkCode('注册密码过短(<6) → 400', regShort, 400)
  const loginBad = await call('POST', '/auth/login', { body: { username: 'nobody_xyz', password: 'whatever' } })
  checkCode('登录错误账号 → 401', loginBad, 401)

  // ---------- 2. 注册 / 登录 / 本人信息 ----------
  T('2. 注册 / 登录 / 本人信息')
  const uA = uniq('testerA'), uB = uniq('testerB'), pw = 'Passw0rd'
  const regA = await call('POST', '/auth/register', { body: { username: uA, password: pw, nickname: '测试A' } })
  checkCode('注册 A 成功', regA, 200)
  const regB = await call('POST', '/auth/register', { body: { username: uB, password: pw, nickname: '测试B' } })
  checkCode('注册 B 成功', regB, 200)
  const dup = await call('POST', '/auth/register', { body: { username: uA, password: pw } })
  checkCode('重复用户名注册 → 409', dup, 409)

  const loginA = await call('POST', '/auth/login', { body: { username: uA, password: pw } })
  checkCode('登录 A 成功', loginA, 200)
  const tokenA = loginA.json?.data?.token
  const userIdA = loginA.json?.data?.user?.id
  check('登录返回 token', typeof tokenA === 'string' && tokenA.length > 10)
  check('登录返回 userId', typeof userIdA === 'number')

  const loginA2 = await call('POST', '/auth/login', { body: { username: uA, password: 'wrong' } })
  checkCode('密码错误 → 401', loginA2, 401)

  const meA = await call('GET', '/auth/me', { token: tokenA })
  checkCode('带 token GET /auth/me 200', meA, 200)
  check('me 返回的用户名一致', meA.json?.data?.username === uA)

  const loginB = await call('POST', '/auth/login', { body: { username: uB, password: pw } })
  const tokenB = loginB.json?.data?.token
  const userIdB = loginB.json?.data?.user?.id

  // ---------- 3. 帖子：发帖 / 详情 / 多种排序 / 点赞 / 收藏 / 标签 ----------
  T('3. 帖子核心链路')
  const newPost = await call('POST', '/posts', {
    token: tokenA,
    body: { title: '回归测试帖', boardId: leaf, content: '这是正文 ![图](https://e.com/a.png)', tags: ['自动测试标签X', '自动测试标签Y'] }
  })
  checkCode('A 发帖成功', newPost, 200)
  const postId = newPost.json?.data?.id
  check('发帖返回 post id', typeof postId === 'number', `postId=${postId}`)

  // 审核流：普通用户新帖默认待审(status=2)，由 admin 审核通过后才能公开访问/回复
  const loginAdmin = await call('POST', '/auth/login', { body: { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') } })
  const tokenAdmin = loginAdmin.json?.data?.token
  check('admin 登录成功', !!tokenAdmin)
  if (tokenAdmin && typeof postId === 'number') {
    const appr = await call('POST', `/admin/posts/${postId}/approve`, { token: tokenAdmin })
    checkCode('admin 审核通过普通用户帖', appr, 200)
  }

  const detail = await call('GET', `/posts/${postId}`)
  checkCode('帖子详情 200', detail, 200)
  check('详情含作者/板块字段', detail.json?.data?.userId === userIdA && detail.json?.data?.boardId === leaf)

  for (const s of ['latest', 'hot', 'essence', 'most_replies', 'most_likes']) {
    const r = await call('GET', '/posts', { query: { sort: s, current: 1, size: 3 } })
    checkCode(`列表排序 sort=${s} 200`, r, 200)
  }

  // 标签设/换：本人可改，他人 403
  const setTags = await call('PUT', `/posts/${postId}/tags`, { token: tokenA, body: { tags: ['自动测试标签X'] } })
  checkCode('作者改标签 200', setTags, 200)
  const setTagsOther = await call('PUT', `/posts/${postId}/tags`, { token: tokenB, body: { tags: ['他人乱改'] } })
  checkCode('非作者改标签 → 403', setTagsOther, 403)

  // 点赞切换 + 通知
  const like1 = await call('POST', `/posts/${postId}/like`, { token: tokenA })
  checkCode('点赞 200', like1, 200)
  check('点赞返回 liked=true', like1.json?.data?.liked === true)
  const like2 = await call('POST', `/posts/${postId}/like`, { token: tokenA })
  check('再次点赞取消 liked=false', like2.json?.data?.liked === false)
  // 他人点赞应给作者发通知
  const likeB = await call('POST', `/posts/${postId}/like`, { token: tokenB })
  checkCode('B 点赞 200', likeB, 200)

  const fav1 = await call('POST', `/posts/${postId}/favorite`, { token: tokenA })
  checkCode('收藏 200', fav1, 200)
  check('收藏返回 favorited=true', fav1.json?.data?.favorited === true)
  const fav2 = await call('POST', `/posts/${postId}/favorite`, { token: tokenA })
  check('取消收藏 favorited=false', fav2.json?.data?.favorited === false)

  // ---------- 4. 回帖 / 楼中楼 ----------
  T('4. 回帖与楼中楼')
  const r1 = await call('POST', `/posts/${postId}/replies`, { token: tokenA, body: { content: '一楼回复' } })
  checkCode('A 回帖 200', r1, 200)
  const replyId = r1.json?.data?.id
  const r2 = await call('POST', `/posts/${postId}/replies`, { token: tokenB, body: { content: '楼中楼回复', replyToId: replyId } })
  checkCode('B 楼中楼回复 200', r2, 200)
  const rEmpty = await call('POST', `/posts/${postId}/replies`, { token: tokenA, body: { content: '' } })
  checkCode('空内容回帖 → 400', rEmpty, 400)
  const rlist = await call('GET', `/posts/${postId}/replies`)
  checkCode('回帖列表 200', rlist, 200)
  check('回帖列表含 2 条', (rlist.json?.data?.length || 0) >= 2)

  // ---------- 5. 关注 ----------
  T('5. 关注关系')
  const f1 = await call('POST', `/follow/${userIdB}`, { token: tokenA })
  checkCode('A 关注 B 200', f1, 200)
  const fcheck = await call('GET', `/follow/check/${userIdB}`, { token: tokenA })
  check('关注后 check.followed=true', fcheck.json?.data?.followed === true)
  const ffol = await call('GET', `/follow/following`, { token: tokenA, query: { current: 1, size: 10 } })
  checkCode('我的关注列表 200', ffol, 200)
  const ffer = await call('GET', `/follow/followers`, { token: tokenB, query: { current: 1, size: 10 } })
  checkCode('B 的粉丝列表 200', ffer, 200)
  const f2 = await call('POST', `/follow/${userIdB}`, { token: tokenA })
  checkCode('再次触发=取消关注 200', f2, 200)
  const fcheck2 = await call('GET', `/follow/check/${userIdB}`, { token: tokenA })
  check('取关后 check.followed=false', fcheck2.json?.data?.followed === false)

  // ---------- 6. 标签 / 搜索 / 统计 ----------
  T('6. 标签 / 搜索 / 统计')
  const tags = await call('GET', '/tags')
  checkCode('GET /tags 200', tags, 200)
  const tagsHot = await call('GET', '/tags/hot')
  checkCode('GET /tags/hot 200', tagsHot, 200)
  const firstTag = Array.isArray(tags.json?.data) ? tags.json.data[0] : null
  if (firstTag?.id) {
    const tDetail = await call('GET', `/tags/${firstTag.id}`)
    checkCode('标签详情 200', tDetail, 200)
    const tPosts = await call('GET', `/tags/${firstTag.id}/posts`)
    checkCode('标签聚合帖子 200', tPosts, 200)
  } else { check('存在可用标签', false, 'tags 为空') }

  for (const [type, key] of [['all', 'posts'], ['post', 'posts'], ['board', 'boards'], ['user', 'users']]) {
    const s = await call('GET', '/search', { query: { keyword: '游戏', type } })
    checkCode(`搜索 type=${type} 200`, s, 200)
  }
  const sEmpty = await call('GET', '/search', { query: { keyword: '', type: 'all' } })
  checkCode('空关键词搜索 200(返回空结果而非 500)', sEmpty, 200)

  const hot = await call('GET', '/stats/hot-posts', { query: { size: 5 } })
  checkCode('热门帖 200', hot, 200)
  const active = await call('GET', '/stats/active-users', { query: { size: 5 } })
  checkCode('活跃用户 200', active, 200)
  const ann = await call('GET', '/stats/announcements')
  checkCode('系统公告 200', ann, 200)

  // ---------- 7. 用户主页 ----------
  T('7. 用户主页(公开)')
  const prof = await call('GET', `/users/${userIdA}`)
  checkCode('GET /users/{id} 200', prof, 200)
  check('主页含脱敏字段', prof.json?.data?.username === uA && 'postCount' in (prof.json?.data || {}))

  // ---------- 8. 私信 / 通知 ----------
  T('8. 私信与通知')
  const conv0 = await call('GET', '/messages/conversations', { token: tokenA })
  checkCode('会话列表 200', conv0, 200)
  const send = await call('POST', '/messages', { token: tokenA, body: { toUserId: userIdB, content: '你好，这是回归测试私信' } })
  checkCode('A 发私信给 B 200', send, 200)
  const conv = await call('GET', '/messages/conversations', { token: tokenA })
  check('发信后会话数≥1', (conv.json?.data?.length || 0) >= 1)
  const dm = await call('GET', `/messages/${userIdB}`, { token: tokenA })
  checkCode('与 B 对话记录 200', dm, 200)
  const read = await call('POST', `/messages/read/${userIdB}`, { token: tokenA })
  checkCode('标记已读 200', read, 200)

  const unreadB = await call('GET', '/notifications/unread-count', { token: tokenB })
  checkCode('B 未读计数 200', unreadB, 200)
  const notiB = await call('GET', '/notifications', { token: tokenB })
  checkCode('B 通知列表 200', notiB, 200)
  const markNoti = await call('POST', '/notifications/read', { token: tokenB })
  checkCode('标记通知已读 200', markNoti, 200)

  // ---------- 9. 资源不存在 ----------
  T('9. 资源不存在兜底')
  const noPost = await call('GET', '/posts/99999999')
  checkCode('不存在帖子详情 → 404', noPost, 404)
  const noLike = await call('POST', '/posts/99999999/like', { token: tokenA })
  checkCode('给不存在帖子点赞 → 404', noLike, 404)

  // ---------- 汇总 ----------
  console.log(`\n========================================`)
  console.log(`结果：${pass} 通过 / ${fail} 失败`)
  if (fail > 0) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)) }
  console.log(`========================================`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('测试运行异常：', e); process.exit(2) })
