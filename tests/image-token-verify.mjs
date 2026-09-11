/**
 * 9-10 第二梯队验证脚本：图片压缩 + 缩略图 + token 滑动续签
 *
 * 前置：后端跑在 8080（`java -jar target/yumu-community-1.0.0.jar --server.port=8080`）
 * 运行：cd tests && node image-token-verify.mjs
 *
 * 覆盖：
 *   A. token 续签
 *      1) 登录拿到 2h token，exp 符合预期
 *      2) POST /auth/refresh 换到新 token（与原 token 不同、有效期重置）
 *      3) 旧 token 立即失效（jti 轮换入黑名单）→ /auth/me 401
 *      4) 新 token 可用 → /auth/me 200
 *      5) 无 token / 伪造 token 调 /auth/refresh → 401（该端点必须鉴权，不能是 permitAll）
 *      6) 前端续签工具函数 expiresInMs / isExpiringSoon 行为正确（直接 import 前端源码）
 *   B. 图片压缩与缩略图
 *      7) 上传 8MB BMP → 返回 .jpg，文件体积显著下降
 *      8) 主图可访问
 *      9) 缩略图 {name}_t.jpg 可访问且更小
 *     10) GIF 不做重编码、不生成缩略图（缩略图 404）
 *     11) 超限图片（>10MB）仍被拒
 */

const BASE = process.env.BASE || 'http://127.0.0.1:8080/api'
const ADMIN = { username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME') }

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ' —— ' + extra : ''}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${extra ? ' —— ' + extra : ''}`)
  }
}

async function post(path, body, token, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function get(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(BASE + path, { headers })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** 生成 24 位 BMP（宽高可控；体积 = 54 + rowSize*H，便于造大文件测压缩）。 */
function makeBmp(width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const dataSize = rowSize * height
  const fileSize = 54 + dataSize
  const buf = Buffer.alloc(fileSize)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(0, 30)
  buf.writeUInt32LE(dataSize, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)
  // 渐变填充（JPEG 友好：压缩后体积极小，便于验证"压缩生效"）
  let p = 54
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf[p++] = (x * 255 / width) | 0
      buf[p++] = (y * 255 / height) | 0
      buf[p++] = ((x + y) * 255 / (width + height)) | 0
    }
    p += rowSize - width * 3
  }
  return buf
}

/** 上传图片，返回 { status, url }（url 为后端返回的 /api/files/xxx）。 */
async function upload(buffer, filename, type, token) {
  const fd = new FormData()
  fd.append('file', new Blob([buffer], { type }), filename)
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers, body: fd })
  const json = await res.json().catch(() => null)
  return { status: res.status, url: json?.data, json }
}

/** 拉取文件，返回 { status, size }。 */
async function fetchFile(url) {
  const res = await fetch('http://127.0.0.1:8080' + url)
  if (!res.ok) return { status: res.status, size: 0 }
  const ab = await res.arrayBuffer()
  return { status: res.status, size: ab.byteLength }
}

function decodeExp(jwt) {
  const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  return JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8')).exp
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  console.log('\n=== 9-10 第二梯队：图片压缩 + token 续签 ===\n')

  // ---------- A. token 续签 ----------
  console.log('A. token 滑动续签')
  const login = await post('/auth/login', ADMIN)
  const token1 = login.json?.data?.token
  ok('1) 登录成功拿到 token', login.json?.code === 200 && !!token1)

  const remainMs = decodeExp(token1) * 1000 - Date.now()
  const hours = remainMs / 3600000
  ok('2) token 有效期为 2h 量级', hours > 1.9 && hours <= 2.01, `实测 ${hours.toFixed(3)}h`)

  const ref = await post('/auth/refresh', null, token1)
  const token2 = ref.json?.data?.token
  ok('3) 续签返回新 token（与旧 token 不同）', ref.json?.code === 200 && !!token2 && token2 !== token1)
  ok('4) 续签返回 expiresIn=7200000', Number(ref.json?.data?.expiresIn) === 7200000)

  // 轮换校验：旧 token 应已被拉黑。
  // 注意本项目约定「HTTP 恒 200，错误码在 body.code」；只有 Security 入口（需要鉴权的接口）
  // 才返回真 HTTP 401。所以两条都验：
  //   ① /auth/me 是 permitAll，未认证时由 Controller 返回 body.code=401；
  //   ② /notifications 需要鉴权，黑名单 token 过不去过滤器 → 真 HTTP 401。
  const oldMe = await get('/auth/me', token1)
  ok('5) 旧 token 续签后立即失效（body.code=401）', oldMe.json?.code === 401, `code=${oldMe.json?.code}`)

  const oldProtected = await get('/notifications', token1)
  ok('5b) 旧 token 访问需鉴权接口被拒（HTTP 401）', oldProtected.status === 401, `http=${oldProtected.status}`)

  const newMe = await get('/auth/me', token2)
  ok('6) 新 token 可正常访问 /auth/me', newMe.status === 200 && newMe.json?.code === 200)

  const noAuth = await post('/auth/refresh', null, null)
  ok('7) 无 token 续签被拒（该端点非 permitAll）', noAuth.status === 401, `http=${noAuth.status}`)

  const fake = await post('/auth/refresh', null, 'a.b.c')
  ok('8) 伪造 token 续签被拒', fake.status === 401, `http=${fake.status}`)

  // 前端工具函数（直接 import 前端源码，保证"临期判定"逻辑与线上一致）
  const t = await import('../frontend/src/utils/tokenAuth.js')
  const soonExpMs = Date.now() + 10 * 60 * 1000
  const fakeSoonToken = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(soonExpMs / 1000) })).toString('base64url')}.y`
  ok('9) 前端 isExpiringSoon：剩 10 分钟 → 需要续签', t.isExpiringSoon(fakeSoonToken) === true)
  ok('10) 前端 isExpiringSoon：刚签发的 2h token → 不需要续签', t.isExpiringSoon(token2) === false)
  ok('11) 前端 expiresInMs 解析正常', t.expiresInMs(token2) > 7000000)

  // ---------- B. 图片压缩 ----------
  console.log('\nB. 图片压缩与缩略图')
  const bmp = makeBmp(1800, 1500) // ≈ 8.1MB，未超 10MB 上限
  ok('12) 测试素材 BMP 体积符合预期（>5MB）', bmp.length > 5 * 1024 * 1024, `${(bmp.length / 1048576).toFixed(2)}MB`)

  const up = await upload(bmp, 'photo.bmp', 'image/bmp', token2)
  const url = up.url
  ok('13) 上传成功且返回 URL', up.json?.code === 200 && typeof url === 'string' && url.startsWith('/api/files/'), url)
  ok('14) BMP 主图被转成 .jpg（体积优化）', typeof url === 'string' && url.endsWith('.jpg'), url)

  const main = await fetchFile(url)
  ok('15) 主图可访问', main.status === 200 && main.size > 0, `size=${(main.size / 1024).toFixed(0)}KB`)
  ok('16) 主图体积显著下降（< 原图 20%）', main.size < bmp.length * 0.2,
    `${(bmp.length / 1048576).toFixed(2)}MB → ${(main.size / 1024).toFixed(0)}KB`)

  const thumbUrl = url.replace(/\.jpg$/, '_t.jpg')
  const thumb = await fetchFile(thumbUrl)
  ok('17) 缩略图可访问', thumb.status === 200 && thumb.size > 0, thumbUrl)
  ok('18) 缩略图小于主图', thumb.size > 0 && thumb.size < main.size,
    `主 ${(main.size / 1024).toFixed(0)}KB / 缩略 ${(thumb.size / 1024).toFixed(0)}KB`)

  // GIF：应原样保存、不生成缩略图
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  const upGif = await upload(gif, 'dot.gif', 'image/gif', token2)
  const gifThumbRes = await fetch('http://127.0.0.1:8080' + String(upGif.url).replace(/\.gif$/, '_t.gif'))
  const gifThumbJson = await gifThumbRes.json().catch(() => null)
  ok('19) GIF 上传成功且保留 .gif 后缀', upGif.json?.code === 200 && String(upGif.url).endsWith('.gif'), upGif.url)
  ok('20) GIF 不生成缩略图（不存在 → code=404）', gifThumbJson?.code === 404,
    `code=${gifThumbJson?.code} ${gifThumbJson?.message || ''}`)

  // 超限：11MB BMP 应被拒
  const big = makeBmp(2000, 1900) // ≈ 11.4MB
  const upBig = await upload(big, 'big.bmp', 'image/bmp', token2)
  ok('21) 超过 10MB 的图片被拒绝', upBig.json?.code === 400, `code=${upBig.json?.code} ${upBig.json?.message || ''}`)

  // 上传必须登录
  const upAnon = await upload(gif, 'dot.gif', 'image/gif', null)
  ok('22) 未登录上传被拒（401）', upAnon.status === 401, `http=${upAnon.status}`)

  // 图片访问宽限：等日志刷出后收尾
  await sleep(100)

  console.log(`\n=== 结果：${pass}/${pass + fail} 通过 ===`)
  if (failures.length) {
    console.log('未通过：\n - ' + failures.join('\n - '))
  }
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
