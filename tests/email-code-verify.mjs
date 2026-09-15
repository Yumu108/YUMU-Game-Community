// 邮箱注册 / 登录 / 忘记密码 / 换绑邮箱 验证（9-15 新功能）
//
// 覆盖：
//   0 测试通道探测（无邮箱注册）   A 注册改必填邮箱 + 验证码
//   B 发码接口 / 场景限制 / 防枚举 / 同邮箱冷却
//   C 账号id 与邮箱双通道登录      D 忘记密码（含验证码一次性消费）
//   E 换绑邮箱（双码校验 / 查重 / 换绑后旧邮箱失效）
//   F 老账号（无邮箱）首次绑定
//
// ⚠️ 运行前必读
//   1. 后端需运行于 http://localhost:8080/api
//   2. 本脚本依赖「自动化测试通道」—— 启动后端时请带上：
//          MAIL_TEST_CODE=123456
//      该通道**仅非生产环境生效**（prod profile 下代码里一票否决）。它让固定码
//      123456 可作为任意场景的「正确码」，从而不必真的去收邮件。
//      ⚠️ 但通道**不会**架空「必须先下发过一枚码」这条约束 —— 所以脚本在每个用到
//      验证码的场景前都真的调了发码接口，走的校验路径与生产完全一致。
//   3. 建议把发码冷却与 IP 上限放宽，否则脚本会被自己的防刷策略挡住：
//          MAIL_CODE_COOLDOWN=3        # 同邮箱重发冷却（默认 60s）
//          MAIL_CODE_IP_PER_HOUR=100   # 同 IP 每小时发码上限（默认 10）
//      脚本会读 MAIL_CODE_COOLDOWN 决定「同邮箱二次发码」前要等多久，
//      所以跑之前请把这个值同时告诉脚本（见下方用法）。
//   4. 本脚本所有注册都会**真实写库**（用户名带 em_ / emb_ / emn_ / emw_ 等前缀），
//      如需清理按前缀删即可。
//
// 用法：
//   MAIL_TEST_CODE=123456 MAIL_CODE_COOLDOWN=3 node tests/email-code-verify.mjs
const BASE = 'http://localhost:8080/api'

const TEST_CODE = (process.env.MAIL_TEST_CODE || '123456').trim()
const WRONG_CODE = TEST_CODE === '999999' ? '111111' : '999999'
// 后端同邮箱发码冷却；默认与生产一致（60s）。本地跑测试建议用 3 秒，否则本脚本要等两分钟。
const COOLDOWN = Math.max(1, Number(process.env.MAIL_CODE_COOLDOWN || 60))

let pass = 0, fail = 0, skip = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗ FAIL:', msg) }
}
function skipped(msg) {
  skip++; console.log('  – SKIP:', msg)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 同一邮箱二次发码前必须等待，否则会撞上 429 冷却。 */
async function waitCooldown(tag) {
  const ms = (COOLDOWN + 1) * 1000
  console.log(`  … 等待 ${COOLDOWN + 1}s（同邮箱发码冷却）→ ${tag}`)
  await sleep(ms)
}

// 每个「逻辑客户端」用一个独立 IP，避免撞上 A2 的 IP 级限频
// （register:ip 5次/5分钟、emailcode:ip 10次/小时、reset:ip 10次/小时、login:ip 20次/分钟）——
// 需要专门测限频的地方再显式传同一个 IP。
let ipSeq = 0
const nextIp = () => `10.${++ipSeq % 250}.${Math.floor(Math.random() * 250)}.17`

async function j(method, path, body, token, ip) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  if (ip) headers['X-Forwarded-For'] = ip
  const r = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  })
  const jj = await r.json().catch(() => ({}))
  return { http: r.status, code: jj.code, data: jj.data, msg: jj.message, raw: jj }
}
const jget = (p, t, ip) => j('GET', p, null, t, ip)
const jpost = (p, b, t, ip) => j('POST', p, b, t, ip)

const S = Date.now().toString(36).slice(-6)
const EMAIL_A = `em_${S}@qq.com`          // 主测试用户（走完整流程）
const EMAIL_B = `emb_${S}@qq.com`         // 第二用户（供「邮箱已被占用」用）
const EMAIL_NEW = `emnew_${S}@qq.com`     // A 换绑后的新邮箱
const EMAIL_COOL = `emcool_${S}@qq.com`   // 专供冷却测试
const EMAIL_NOM = `emn_${S}@qq.com`       // 无邮箱账号后来绑的邮箱
const EMAIL_A_UP = EMAIL_A.toUpperCase()
const PW = 'pass123456'
const PW_NEW = 'newpass123'

let tokA = '', tokNoMail = ''
const UNAME_A = 'em_' + S, UNAME_B = 'emb_' + S, UNAME_NOM = 'emn_' + S

async function main() {
  console.log('═══ 邮箱注册 / 登录 / 忘记密码 / 换绑 验证 ═══')
  console.log(`测试码=${TEST_CODE}  错误码=${WRONG_CODE}  发码冷却=${COOLDOWN}s  后缀=${S}\n`)

  // ── 0. 探测「自动化测试通道」是否开启 ─────────────────────────
  console.log('[0] 探测自动化测试通道（不带邮箱注册）')
  const probe = await jpost('/auth/register', { username: UNAME_NOM, password: PW, nickname: '无邮箱账号' }, null, nextIp())
  const TEST_CHANNEL = probe.code === 200 && !!probe.data?.token
  if (!TEST_CHANNEL) {
    console.log(`  ✗ 测试通道未开启（code=${probe.code} msg="${probe.msg}"）`)
    console.log(`  ⚠️ 请用 MAIL_TEST_CODE=${TEST_CODE} 重启后端后再跑本脚本。`)
    process.exit(1)
  }
  tokNoMail = probe.data.token
  assert(true, `测试通道已开启，无邮箱注册被放行（${UNAME_NOM}，留作 F 组使用）`)

  // ═══ A. 注册（邮箱 + 验证码） ═══
  console.log('\n[A] 注册：邮箱必填 + 验证码校验')

  // A1 发码（register 场景）
  const a1 = await jpost('/auth/email-code', { email: EMAIL_A, scene: 'register' }, null, nextIp())
  assert(a1.code === 200, `register 场景发码成功（code=${a1.code} msg="${a1.msg}"）`)

  // A2 邮箱格式错
  const a2 = await jpost('/auth/register',
    { username: 'embad_' + S, password: PW, email: 'not-an-email', emailCode: TEST_CODE }, null, nextIp())
  assert(a2.code === 400, `邮箱格式错被拒 400（code=${a2.code} msg="${a2.msg}"）`)

  // A3 验证码错 → 400
  const a3 = await jpost('/auth/register',
    { username: 'emw_' + S, password: PW, email: EMAIL_A, emailCode: WRONG_CODE }, null, nextIp())
  assert(a3.code === 400 && /验证码/.test(a3.msg || ''), `验证码错被拒 400（code=${a3.code} msg="${a3.msg}"）`)

  // A4 正确码注册 → 200
  const a4 = await jpost('/auth/register',
    { username: UNAME_A, password: PW, email: EMAIL_A, emailCode: TEST_CODE }, null, nextIp())
  assert(a4.code === 200 && !!a4.data?.token, `邮箱 + 正确码注册成功（code=${a4.code} msg="${a4.msg}"）`)
  tokA = a4.data?.token || ''
  assert(a4.data?.user?.email === EMAIL_A, `注册返回 email = ${a4.data?.user?.email}`)

  // A5 同邮箱（大写形式）再注册 → 409（顺带验证地址归一化）
  const a5 = await jpost('/auth/register',
    { username: 'emdup_' + S, password: PW, email: EMAIL_A_UP, emailCode: TEST_CODE }, null, nextIp())
  assert(a5.code === 409 && /邮箱/.test(a5.msg || ''), `同邮箱（大写形式）再注册被拒 409（code=${a5.code} msg="${a5.msg}"）`)

  // A6 同账号id再注册 → 409
  const a6 = await jpost('/auth/register',
    { username: UNAME_A, password: PW, email: `other_${S}@qq.com`, emailCode: TEST_CODE }, null, nextIp())
  assert(a6.code === 409 && /账号id/.test(a6.msg || ''), `同账号id再注册被拒 409（code=${a6.code} msg="${a6.msg}"）`)

  // A7 注册第二个用户 B
  const a7s = await jpost('/auth/email-code', { email: EMAIL_B, scene: 'register' }, null, nextIp())
  const a7 = await jpost('/auth/register',
    { username: UNAME_B, password: PW, email: EMAIL_B, emailCode: TEST_CODE }, null, nextIp())
  assert(a7s.code === 200 && a7.code === 200, `注册用户 B 成功（发码 ${a7s.code} / 注册 ${a7.code} msg="${a7.msg}"）`)

  // ═══ B. 发码接口：场景限制 / 防枚举 / 冷却 ═══
  console.log('\n[B] 发码接口 /auth/email-code')

  const b1 = await jpost('/auth/email-code', { email: EMAIL_A, scene: 'register' }, null, nextIp())
  assert(b1.code === 409, `已注册邮箱走 register 发码被拒 409（code=${b1.code} msg="${b1.msg}"）`)

  const b2 = await jpost('/auth/email-code', { email: `nobody_${S}@qq.com`, scene: 'reset' }, null, nextIp())
  assert(b2.code === 200, `未注册邮箱走 reset 发码静默 200（防枚举核心）（code=${b2.code} msg="${b2.msg}"）`)

  const b3 = await jpost('/auth/email-code', { email: `x_${S}@qq.com`, scene: 'bind' }, null, nextIp())
  assert(b3.code === 400, `免登录入口传 scene=bind 被拒 400（code=${b3.code} msg="${b3.msg}"）`)

  const b4 = await jpost('/auth/email-code', { email: `x_${S}@qq.com`, scene: 'whatever' }, null, nextIp())
  assert(b4.code === 400, `非法场景被拒 400（code=${b4.code} msg="${b4.msg}"）`)

  // B5 同邮箱冷却（不动用真实邮件：mock 模式下只打日志）
  //   注意：不能用「未注册邮箱 + reset 场景」来测 —— 那条路在防枚举分支就静默返回了，
  //        根本走不到冷却检查。这里用「已登录的 bind 场景」发第一次，
  //        再用「免登录的 register 场景」发第二次，才能证明冷却**不分场景**。
  const b5a = await jpost('/user/email/code', { scene: 'new', email: EMAIL_COOL }, tokA, nextIp())
  const b5b = await jpost('/user/email/code', { scene: 'new', email: EMAIL_COOL }, tokA, nextIp())
  assert(b5a.code === 200, `冷却测试第 1 次发码成功（bind 场景，code=${b5a.code}）`)
  assert(b5b.code === 429, `同邮箱同场景立即重发被拒 429（code=${b5b.code} msg="${b5b.msg}"）`)
  const b5c = await jpost('/auth/email-code', { email: EMAIL_COOL, scene: 'register' }, null, nextIp())
  assert(b5c.code === 429, `换场景（register）重发同样受冷却约束 429（防「换场景刷同一地址」）（code=${b5c.code} msg="${b5c.msg}"）`)

  // ═══ C. 登录：账号id 与邮箱双通道 ═══
  console.log('\n[C] 登录')

  const c1 = await jpost('/auth/login', { username: UNAME_A, password: PW }, null, nextIp())
  assert(c1.code === 200 && !!c1.data?.token, `账号id 登录成功（code=${c1.code}）`)

  const c2 = await jpost('/auth/login', { username: EMAIL_A, password: PW }, null, nextIp())
  assert(c2.code === 200 && !!c2.data?.token, `邮箱登录成功（code=${c2.code}）`)

  const c3 = await jpost('/auth/login', { username: EMAIL_A_UP, password: PW }, null, nextIp())
  assert(c3.code === 200 && !!c3.data?.token, `邮箱大写形式登录成功（大小写不敏感）（code=${c3.code}）`)

  const c4 = await jpost('/auth/login', { username: EMAIL_A, password: 'wrongpass' }, null, nextIp())
  assert(c4.code === 401, `邮箱 + 错密码被拒 401（code=${c4.code} msg="${c4.msg}"）`)

  const c5 = await jpost('/auth/login', { username: `ghost_${S}@qq.com`, password: PW }, null, nextIp())
  assert(c5.code === 401, `未注册邮箱登录被拒 401（code=${c5.code} msg="${c5.msg}"）`)

  // ═══ D. 忘记密码 ═══
  console.log('\n[D] 忘记密码 /auth/reset-password')

  // D1 未注册邮箱 → 与「验证码错」同一提示（防枚举）
  const d1 = await jpost('/auth/reset-password',
    { email: `nobody_${S}@qq.com`, emailCode: TEST_CODE, newPassword: PW_NEW }, null, nextIp())
  assert(d1.code === 400, `未注册邮箱重置被拒 400（code=${d1.code} msg="${d1.msg}"）`)

  // D2 给 EMAIL_A 发重置码（该地址在 A1 已发过一次，需等冷却）
  await waitCooldown('给 EMAIL_A 发 reset 码')
  const d2s = await jpost('/auth/email-code', { email: EMAIL_A, scene: 'reset' }, null, nextIp())
  assert(d2s.code === 200, `已注册邮箱走 reset 发码成功（code=${d2s.code} msg="${d2s.msg}"）`)

  // D3 用码重置 → 成功
  const d3 = await jpost('/auth/reset-password',
    { email: EMAIL_A, emailCode: TEST_CODE, newPassword: PW_NEW }, null, nextIp())
  assert(d3.code === 200, `邮箱验证码重置密码成功（code=${d3.code} msg="${d3.msg}"）`)

  // D4 同一个码再用一次 → 失败（一次性消费，通道不架空该语义）
  const d4 = await jpost('/auth/reset-password',
    { email: EMAIL_A, emailCode: TEST_CODE, newPassword: 'another123' }, null, nextIp())
  assert(d4.code === 400, `同一验证码二次使用被拒 400（一次性消费）（code=${d4.code} msg="${d4.msg}"）`)

  // D5 新密码可用（走账号id，避开登录「同账号 5 次/分钟」的限频桶）
  const d5 = await jpost('/auth/login', { username: UNAME_A, password: PW_NEW }, null, nextIp())
  assert(d5.code === 200 && !!d5.data?.token, `新密码登录成功（code=${d5.code}）`)

  // D6 旧密码失效
  const d6 = await jpost('/auth/login', { username: UNAME_A, password: PW }, null, nextIp())
  assert(d6.code === 401, `旧密码已失效 401（code=${d6.code}）`)

  // ═══ E. 换绑邮箱 ═══
  console.log('\n[E] 换绑邮箱 /user/email/*')

  const e1 = await jpost('/user/email/code', { scene: 'new', email: EMAIL_NEW }, null, nextIp())
  assert(e1.code === 401, `未登录调发码接口被拒 401（code=${e1.code}）`)

  const e2 = await jpost('/user/email/code', { scene: 'new', email: EMAIL_NEW }, tokA, nextIp())
  assert(e2.code === 200, `新邮箱发码成功（code=${e2.code} msg="${e2.msg}"）`)

  const e3 = await jpost('/user/email/code', { scene: 'new', email: EMAIL_B }, tokA, nextIp())
  assert(e3.code === 409, `新邮箱已被占用被拒 409（code=${e3.code} msg="${e3.msg}"）`)

  const e4 = await jpost('/user/email/code', { scene: 'new', email: EMAIL_A }, tokA, nextIp())
  assert(e4.code === 400, `新邮箱与当前相同被拒 400（code=${e4.code} msg="${e4.msg}"）`)

  // E5 原邮箱发码（需等 EMAIL_A 的冷却）
  await waitCooldown('给 EMAIL_A 发 unbind 码')
  const e5 = await jpost('/user/email/code', { scene: 'old' }, tokA, nextIp())
  assert(e5.code === 200, `原邮箱发码成功（code=${e5.code} msg="${e5.msg}"）`)

  // E6 新邮箱码错 → 400
  const e6 = await jpost('/user/email/bind',
    { email: EMAIL_NEW, emailCode: WRONG_CODE, oldEmailCode: TEST_CODE }, tokA, nextIp())
  assert(e6.code === 400, `新邮箱验证码错被拒 400（code=${e6.code} msg="${e6.msg}"）`)

  // E7 已绑定账号缺原邮箱码 → 400，且**不能**把新邮箱码消费掉
  const e7 = await jpost('/user/email/bind',
    { email: EMAIL_NEW, emailCode: TEST_CODE }, tokA, nextIp())
  assert(e7.code === 400 && /原邮箱|当前/.test(e7.msg || ''), `缺原邮箱验证码被拒 400（code=${e7.code} msg="${e7.msg}"）`)

  // E8 双码正确 → 200（若 E7 误消费了新码，这里会因「验证码已过期」而失败）
  const e8 = await jpost('/user/email/bind',
    { email: EMAIL_NEW, emailCode: TEST_CODE, oldEmailCode: TEST_CODE }, tokA, nextIp())
  assert(e8.code === 200, `双码正确换绑成功（E7 未误消费新码）（code=${e8.code} msg="${e8.msg}"）`)
  assert(e8.data?.email === EMAIL_NEW, `换绑后返回 email = ${e8.data?.email}`)

  const e9 = await jpost('/auth/login', { username: EMAIL_A, password: PW_NEW }, null, nextIp())
  assert(e9.code === 401, `旧邮箱换绑后无法登录 401（code=${e9.code}）`)

  const e10 = await jpost('/auth/login', { username: EMAIL_NEW, password: PW_NEW }, null, nextIp())
  assert(e10.code === 200 && !!e10.data?.token, `新邮箱可登录（code=${e10.code}）`)

  const e11 = await jget('/auth/me', tokA, nextIp())
  assert(e11.code === 200 && e11.data?.email === EMAIL_NEW, `/auth/me 返回新邮箱 = ${e11.data?.email}`)

  const e12 = await jpost('/user/email/bind',
    { email: EMAIL_B, emailCode: TEST_CODE, oldEmailCode: TEST_CODE }, tokA, nextIp())
  assert(e12.code === 409, `换绑到他人邮箱被拒 409（code=${e12.code} msg="${e12.msg}"）`)

  // ═══ F. 老账号（无邮箱）首次绑定 ═══
  console.log('\n[F] 无邮箱老账号首次绑定')

  const f1 = await jpost('/user/email/code', { scene: 'new', email: EMAIL_NOM }, tokNoMail, nextIp())
  assert(f1.code === 200, `无邮箱账号为新邮箱发码成功（code=${f1.code} msg="${f1.msg}"）`)

  const f2 = await jpost('/user/email/code', { scene: 'old' }, tokNoMail, nextIp())
  assert(f2.code === 400 && /还没有绑定邮箱/.test(f2.msg || ''), `无邮箱账号请求原邮箱码被拒 400（code=${f2.code} msg="${f2.msg}"）`)

  const f3 = await jpost('/user/email/bind', { email: EMAIL_NOM, emailCode: TEST_CODE }, tokNoMail, nextIp())
  assert(f3.code === 200 && f3.data?.email === EMAIL_NOM, `首次绑定成功（无需原邮箱码）（code=${f3.code} msg="${f3.msg}"）`)

  const f4 = await jpost('/auth/login', { username: EMAIL_NOM, password: PW }, null, nextIp())
  assert(f4.code === 200 && !!f4.data?.token, `首次绑定后可用邮箱登录（code=${f4.code}）`)

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败${skip ? ` / ${skip} 跳过` : ''} ═══`)
  if (fail) console.log(`（本次测试账号后缀 ${S}，可按此前缀清理：em_ / emb_ / emn_ / emw_ / emdup_ / embad_ ）`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('运行异常', e); process.exit(1) })
