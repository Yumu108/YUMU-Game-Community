// A1~A4 安全加固冒烟测试（9-09）
// 覆盖：
//  A1 服务端 HTML 净化：发帖含 <script>/<img onerror>，取回时应被剥掉
//  A2 频率限制：登录 5 次内同用户失败 → 第 6 次应被 429
//  A3 JWT 黑名单 + 短期 token：登录拿 token → 退出 → 同一 token 再访问应 401
//  A4 上传魔数校验：.jpg 文件但实际是 PHP 内容 → 应 400（文件内容与扩展名不符）

const BASE = 'http://localhost:8080/api';

function jpost(url, body, headers = {}) {
  return fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({
    status: r.status,
    body: await r.json().catch(() => ({}))
  }));
}
function jget(url, headers = {}) {
  return fetch(BASE + url, { headers }).then(async r => ({
    status: r.status,
    body: await r.json().catch(() => ({}))
  }));
}
function jupload(url, formData, headers = {}) {
  return fetch(BASE + url, { method: 'POST', body: formData, headers }).then(async r => ({
    status: r.status,
    body: r.headers.get('content-type')?.includes('json')
      ? await r.json().catch(() => ({}))
      : await r.text()
  }));
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`);
}

(async () => {
  // 重要：本项目约定「HTTP 永远 200，业务码放在 body.code」（参见 Result.java + GlobalExceptionHandler）
  // 只有 SecurityConfig 的 EntryPoint / AccessDeniedHandler 才会真的设 HTTP 401/403（因为是直接 response.setStatus）
  // 所以测断言必须分两类：
  //   - BusinessException 走 Result 的 → 看 body.code
  //   - Security 入口（/auth/me 未登录、/upload 未登录等）→ 看 HTTP status
  // 下面每个 record 都会注明检查的是哪一类。

  // 先拿一个 admin token 用来发帖（绕过 429 限频 + 需要登录）
  // admin 默认账号：admin / $TEST_ADMIN_PASSWORD（环境变量，仓库不存真实口令）
  const login = await jpost('/auth/login', {
    username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME')
  });
  if (login.status !== 200) {
    console.error('login failed:', login);
    process.exit(1);
  }
  const adminToken = login.body.data.token;
  const adminAuth = { Authorization: 'Bearer ' + adminToken };
  console.log('admin login OK');

  // ======== A1 服务端 HTML 净化 ========
  {
    const evilContent = '测试<script>alert(1)</script><img src=x onerror=alert(2)>内容'
        + '<a href="javascript:alert(3)">JS链接</a>'
        + '<iframe src="https://evil"></iframe>'
        + '正文https://example.com legit link'; // 故意留一段正常内容

    // 拿一个公开板块
    const boards = await jget('/boards');
    const boardId = boards.body.data[0].id;

    const created = await jpost('/posts', {
      title: 'A1-净化测试-自动',
      boardId,
      content: evilContent
    }, adminAuth);
    const postId = created.body?.data?.id;
    if (!postId) {
      record('A1-发帖', false, JSON.stringify(created));
    } else {
      // 拉回该帖详情
      const got = await jget('/posts/' + postId, adminAuth);
      const stored = got.body.data.content;
      const stripped =
          !stored.includes('<script') &&
          !stored.includes('onerror=') &&
          !stored.includes('<iframe') &&
          !stored.includes('javascript:');
      record('A1-XSS 净化', stripped,
          `原始含 <script>/onerror/<iframe>/javascript:，存储后 = ${JSON.stringify(stored.slice(0, 80))}...`);

      // 清理测试帖
      await jpost('/posts/' + postId + '/delete', {}, adminAuth).catch(()=>{});
    }
  }

  // ======== A2 频率限制（BusinessException 429 → 看 body.code） ========
  {
    const username = 'rate_test_user_' + Date.now();
    let blocked = false;
    let firstBlockAt = null;
    let firstBodyCode = null;
    for (let i = 0; i < 8; i++) {
      const r = await jpost('/auth/login', {
        username, password: 'wrong_' + i
      });
      if (r.body && r.body.code === 429) {
        blocked = true;
        if (firstBlockAt === null) { firstBlockAt = i + 1; firstBodyCode = r.body.code; }
        break;
      }
    }
    record('A2-限频触发 429',
        blocked && firstBodyCode === 429,
        blocked ? `第 ${firstBlockAt} 次 body.code=${firstBodyCode}` : '8 次均未触发');
  }

  // ======== A3 JWT 黑名单（/auth/me 走 Result.error(401)，看 body.code） ========
  {
    const r = await jpost('/auth/login', {
      username: 'admin', password: (process.env.TEST_ADMIN_PASSWORD || 'REPLACE-ME')
    });
    const t = r.body.data.token;

    // 1) token 有效 → /me 应有用户信息
    const me1 = await jget('/auth/me', { Authorization: 'Bearer ' + t });
    // 2) 退出
    const logoutResp = await jpost('/auth/logout', {}, { Authorization: 'Bearer ' + t });
    // 3) 旧 token 再访问 → 应失效（看 body.code）
    const me2 = await jget('/auth/me', { Authorization: 'Bearer ' + t });
    const tokenActive = me1.body && me1.body.code === 200 && me1.body.data;
    const tokenKilled = me2.body && me2.body.code === 401;
    record('A3-退出后 token 即时失效',
        tokenActive && tokenKilled,
        `退出前 body.code=${me1.body?.code}，退出后 body.code=${me2.body?.code}（消息=${me2.body?.message}）`);

    // 4) 检查 token 实际有效时长（应约 2h，不再是 24h）
    const claims = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    const expSec = claims.exp - claims.iat;
    record('A3-token 有效期 = 2h',
        expSec <= 7200 + 10 && expSec >= 7190,
        `iat→exp = ${expSec}s（约 ${(expSec/3600).toFixed(2)}h）`);
  }

  // ======== A4 上传魔数校验 ========
  {
    // 1) 正常 jpg 上传 → body.code === 200
    const realJpg = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
      0x01, 0x01, 0x00, 0x00, 0x01
    ]);
    const fd1 = new FormData();
    fd1.append('file', new Blob([realJpg], { type: 'image/jpeg' }), 'good.jpg');
    const ok = await jupload('/upload', fd1, adminAuth);
    record('A4-合法 jpg 上传',
        ok.status === 200 && ok.body.code === 200,
        `HTTP=${ok.status} body.code=${ok.body.code} url=${ok.body.data}`);

    // 2) 扩展名为 jpg 但内容是 PHP → body.code === 400（BusinessException → 看 body.code）
    const fakeJpg = Buffer.from('<?php echo "evil"; ?>');
    const fd2 = new FormData();
    fd2.append('file', new Blob([fakeJpg], { type: 'image/jpeg' }), 'evil.jpg');
    const rejected = await jupload('/upload', fd2, adminAuth);
    record('A4-PHP 伪装 jpg 被拒',
        rejected.body && rejected.body.code === 400,
        `HTTP=${rejected.status} body.code=${rejected.body?.code} message=${rejected.body?.message}`);

    // 3) 未登录上传 → SecurityConfig EntryPoint 真返 HTTP 401（response.setStatus）
    const fd3 = new FormData();
    fd3.append('file', new Blob([realJpg], { type: 'image/jpeg' }), 'anon.jpg');
    const anon = await jupload('/upload', fd3, {});
    record('A4-未登录上传被拒',
        anon.status === 401,
        `HTTP=${anon.status} body=${typeof anon.body === 'string' ? anon.body.slice(0, 80) : JSON.stringify(anon.body).slice(0, 80)}`);
  }

  // ======== 汇总 ========
  const total = results.length;
  const pass = results.filter(r => r.pass).length;
  console.log('\n========= A1~A4 验证汇总 =========');
  console.log(`${pass}/${total} 通过`);
  if (pass < total) {
    console.log('\n失败项:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
    process.exit(1);
  }
})().catch(e => {
  console.error('test crashed:', e);
  process.exit(2);
});