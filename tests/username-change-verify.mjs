// 账号(登录名)修改 + 密码修改 + 【账号 vs 昵称 分离语义】验证
//
// 覆盖：
//   ① 个人主页返回账号 ② 首次可改 ③ 每年一次拦截 ④ 与当前相同拦截
//   ⑤ 被占用拦截 ⑥ 格式校验 ⑦ 密码修改(原密码错误/正确)
//   ⑧-⑬ 账号与昵称是两个东西（9-16 追加，起因：个人中心只显示昵称、账号位空着）：
//        改昵称无限制 / 改昵称不动账号 / 改账号不动昵称 / 昵称可重名 /
//        昵称不能用于登录 / 帖子列表展示的是昵称
//
// 用法：node tests/username-change-verify.mjs
//   API_BASE=http://localhost:8081/api   指定后端（默认 8080）
//   ⚠️ 注册受 IP 限频（register:ip = 5 次/5 分钟）。所有请求带随机
//      X-Forwarded-For（RequestUtils.clientIp 优先读它）来隔离限频桶，
//      否则连跑几遍就会被 429 挡住，看起来像大面积回归。
const BASE = process.env.API_BASE || 'http://localhost:8080/api'

let pass = 0, fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗ FAIL:', msg) }
}
/** 每个请求换一个假 IP，隔离按 IP 计数的限频桶（注册 5 次/5 分钟、发码 10 次/时）。 */
let ipSeq = 0
const nextIp = () =>
  `10.${(++ipSeq) % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

async function j(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': nextIp(),
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const j = await r.json().catch(() => ({}))
  return { http: r.status, code: j.code, data: j.data, msg: j.message, raw: j }
}
const jget = (p, t) => j('GET', p, null, t)
const jpost = (p, b, t) => j('POST', p, b, t)
const jput = (p, b, t) => j('PUT', p, b, t)

const suffix = Date.now().toString(36).slice(-6)
let tok = '', uid = null

async function main() {
  console.log('═══ 账号修改 / 密码修改 验证 ═══\n')

  // 0. 注册并登录一个全新用户（不动 admin，避免其它测试登录失败）
  const reg = await jpost('/auth/register', {
    username: 'uname_' + suffix, password: 'pass123456', nickname: 'UName'
  })
  assert(reg.code === 200 && reg.data?.token, '注册测试用户 UName')
  tok = reg.data.token; uid = reg.data.user?.id

  // 1. /auth/me 返回账号相关字段，且从未改过 → 可改
  console.log('\n[1] getMe 返回账号与可改状态')
  const me0 = await jget('/auth/me', tok)
  assert(me0.code === 200 && me0.data?.username === 'uname_' + suffix, `me.username = ${me0.data?.username}`)
  assert(me0.data?.canChangeUsername === true, '从未改过 → canChangeUsername=true')
  assert(me0.data?.nextUsernameChangeAt == null, '从未改过 → nextUsernameChangeAt=null')

  // 2. 个人主页 GET /users/{id} 包含 username
  console.log('\n[2] 个人主页返回账号')
  const prof = await jget('/users/' + uid, tok)
  assert(prof.code === 200 && prof.data?.username === 'uname_' + suffix, `profile.username = ${prof.data?.username}`)

  // 3. 首次修改账号 → 成功，且变为不可改
  console.log('\n[3] 首次修改账号（应成功）')
  const new1 = 'newacct_' + suffix
  const up1 = await jput('/users/me/username', { username: new1 }, tok)
  assert(up1.code === 200 && up1.data?.username === new1, `修改成功 → username=${up1.data?.username}`)
  assert(up1.data?.canChangeUsername === false, '改过一次后 → canChangeUsername=false')
  assert(up1.data?.nextUsernameChangeAt != null, '改过一次后 → nextUsernameChangeAt 有值(未来日期)')
  // 校验下次可改时间在约 1 年后
  if (up1.data?.nextUsernameChangeAt) {
    const next = new Date(up1.data.nextUsernameChangeAt)
    const yearLater = Date.now() + 360 * 24 * 3600 * 1000
    assert(next.getTime() > yearLater, '下次可改时间 ≈ 1 年后')
  }

  // 4. 立即再次修改 → 应被「每年一次」拦截 (code 429)
  console.log('\n[4] 不足一年再次修改（应拦截 429）')
  const up2 = await jput('/users/me/username', { username: 'another_' + suffix }, tok)
  assert(up2.code === 429 && /年/.test(up2.msg || ''), `拦截成功 code=${up2.code} msg="${up2.msg}"`)

  // 5. 改成与当前相同 → 400
  console.log('\n[5] 新账号与当前相同（应 400）')
  const up3 = await jput('/users/me/username', { username: new1 }, tok)
  assert(up3.code === 400, `code=${up3.code} msg="${up3.msg}"`)

  // 6. 改成已存在的账号(admin) → 409
  console.log('\n[6] 改成已占用账号（应 409）')
  const up4 = await jput('/users/me/username', { username: 'admin' }, tok)
  assert(up4.code === 409, `code=${up4.code} msg="${up4.msg}"`)

  // 7. 格式校验：太短 / 含非法字符 → 400
  console.log('\n[7] 格式校验（应 400）')
  const up5 = await jput('/users/me/username', { username: 'ab' }, tok)
  assert(up5.code === 400, `太短 code=${up5.code}`)
  const up6 = await jput('/users/me/username', { username: 'bad name!' }, tok)
  assert(up6.code === 400, `含非法字符 code=${up6.code}`)

  // 8. 密码修改：原密码错误 → 400；正确 → 成功
  console.log('\n[8] 密码修改')
  const pwWrong = await jput('/users/me/password', { oldPassword: 'wrong123', newPassword: 'newpass123' }, tok)
  assert(pwWrong.code === 400, `原密码错误 → code=${pwWrong.code}`)
  const pwOk = await jput('/users/me/password', { oldPassword: 'pass123456', newPassword: 'newpass123' }, tok)
  assert(pwOk.code === 200, '原密码正确 → 修改成功')

  // 9. 用新密码登录验证
  console.log('\n[9] 新密码登录验证')
  const reLogin = await jpost('/auth/login', { username: new1, password: 'newpass123' })
  assert(reLogin.code === 200 && reLogin.data?.token, '用新账号+新密码登录成功')

  // ════════════════════════════════════════════════════════════════
  // 9-16 追加：账号（username）与昵称（nickname）是**两个东西**
  //   · 账号 = 唯一标识，可登录，每年只能改一次
  //   · 昵称 = 展示名，可重名、可随时改，帖子里显示的是它
  // ════════════════════════════════════════════════════════════════

  console.log('\n[10] 改昵称独立于账号（昵称不受「每年一次」限制）')
  const nick1 = '昵称' + suffix
  const np1 = await jput('/users/me/profile', { nickname: nick1 }, tok)
  assert(np1.code === 200, `改昵称成功 code=${np1.code} msg="${np1.msg || ''}"`)
  assert(np1.data?.nickname === nick1, `nickname 已更新 → ${np1.data?.nickname}`)
  assert(np1.data?.username === new1, `账号不受改昵称影响，仍是 ${np1.data?.username}`)

  console.log('\n[11] 账号此刻已锁死，昵称却还能继续改（对照证明两者限制不同）')
  const nick2 = '昵称又改' + suffix
  const np2 = await jput('/users/me/profile', { nickname: nick2 }, tok)
  assert(np2.code === 200 && np2.data?.nickname === nick2, `连续改昵称仍成功 → ${np2.data?.nickname}`)

  console.log('\n[12] 昵称允许重名（账号不允许）')
  const dup = await jpost('/auth/register', {
    username: 'nickdup_' + suffix, password: 'pass123456', nickname: nick2
  })
  assert(dup.code === 200 && dup.data?.token, `另一个用户用了同一昵称，注册成功 code=${dup.code}`)
  assert(dup.data?.user?.nickname === nick2, `新用户昵称 = ${dup.data?.user?.nickname}（与前者完全同名）`)

  console.log('\n[13] 登录标识只能是账号（或邮箱），昵称不能登录')
  const byNick = await jpost('/auth/login', { username: nick2, password: 'pass123456' })
  assert(byNick.code !== 200, `用昵称登录被拒 code=${byNick.code}（昵称可重名，不能当登录标识）`)
  const byAcct = await jpost('/auth/login', { username: new1, password: 'newpass123' })
  assert(byAcct.code === 200 && byAcct.data?.token, '用账号+密码登录正常')

  console.log('\n[14] 帖子列表展示的是昵称，不是账号')
  const list = await jget('/posts?size=5', tok)
  const recs = list.data?.records || []
  assert(recs.length > 0, `取到 ${recs.length} 条帖子用于比对`)
  for (const p of recs.slice(0, 3)) {
    const u = await jget('/users/' + p.userId, tok)
    const expected = u.data?.nickname || u.data?.username
    assert(
      p.authorName === expected,
      `帖子#${p.id} 作者显示「${p.authorName}」= 该作者昵称「${expected}」(userId=${p.userId})`
    )
  }

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('运行异常', e); process.exit(1) })
