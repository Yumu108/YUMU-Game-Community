// C1 敏感词/联系方式风控 + C2 举报闭环 冒烟测试
// 前置：后端 8080 已启动。运行：cd tests && node security-c1-c2-risk-report.mjs
const BASE = 'http://localhost:8080/api';
const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '  | ' + detail : ''}`);
}

async function jpost(path, body = {}, headers = {}) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  let b = null;
  try { b = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body: b };
}
async function jget(path, headers = {}) {
  const r = await fetch(BASE + path, { headers });
  let b = null;
  try { b = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body: b };
}

(async () => {
  const login = await jpost('/auth/login', { username: 'admin', password: 'admin123456' });
  const token = login.body?.data?.token;
  if (!token) { console.error('admin login failed'); process.exit(1); }
  const auth = { Authorization: 'Bearer ' + token };
  console.log('admin login OK\n');

  // ======== C1-1 违禁词拦截（发帖） ========
  {
    const boards = await jget('/boards');
    const boardId = boards.body.data[0].id;
    const r = await jpost('/posts', {
      title: 'C1-违禁词测试',
      boardId,
      content: '这是一个含有赌博内容的帖子'
    }, auth);
    record('C1-违禁词发帖被拦', r.body?.code === 400,
        `code=${r.body?.code} msg=${r.body?.message}`);
  }

  // ======== C1-2 违禁词拦截（回复） ========
  {
    // 找一个公开帖子
    const posts = await jget('/posts?current=1&size=1');
    const postId = posts.body?.data?.records?.[0]?.id;
    if (!postId) {
      record('C1-违禁词回复被拦', false, '没有可用公开帖，跳过');
    } else {
      const r = await jpost(`/posts/${postId}/replies`, { content: '刷单兼职日结加我' }, auth);
      record('C1-违禁词回复被拦', r.body?.code === 400,
          `code=${r.body?.code} msg=${r.body?.message}`);
    }
  }

  // ======== C1-3 站外联系方式：ADMIN 发帖也强制转待审 ========
  {
    const boards = await jget('/boards');
    const boardId = boards.body.data[0].id;
    const created = await jpost('/posts', {
      title: 'C1-联系方式风控测试',
      boardId,
      content: '欢迎交流，我的微信 abc12345 加我详聊'
    }, auth);
    const postId = created.body?.data?.id;
    if (!postId) {
      record('C1-联系方式帖转待审', false, JSON.stringify(created.body));
    } else {
      const got = await jget('/posts/' + postId, auth);
      const st = got.body?.data?.status;
      record('C1-联系方式帖转待审', st === 2,
          `ADMIN 直发含微信联系方式 → status=${st}（期望 2 待审核）`);
      // 清理：删除测试帖
      await jpost('/posts/' + postId + '/delete', {}, auth).catch(() => {});
    }
  }

  // ======== C1-4 站外联系方式：回复直接拦截 ========
  {
    const posts = await jget('/posts?current=1&size=1');
    const postId = posts.body?.data?.records?.[0]?.id;
    if (!postId) {
      record('C1-联系方式回复被拦', false, '没有可用公开帖，跳过');
    } else {
      const r = await jpost(`/posts/${postId}/replies`, { content: '加我扣扣 12345678 私聊' }, auth);
      record('C1-联系方式回复被拦', r.body?.code === 400,
          `code=${r.body?.code} msg=${(r.body?.message || '').slice(0, 40)}`);
    }
  }

  // ======== C1-5 正常内容不受影响（ADMIN 直发 status=0） ========
  {
    const boards = await jget('/boards');
    const boardId = boards.body.data[0].id;
    const created = await jpost('/posts', {
      title: 'C1-正常内容对照测试',
      boardId,
      content: '这篇是正常攻略分享，数字 13800138000 出现在剧情里但无联系方式关键词'
    }, auth);
    const postId = created.body?.data?.id;
    if (!postId) {
      record('C1-正常内容不受影响', false, JSON.stringify(created.body));
    } else {
      const got = await jget('/posts/' + postId, auth);
      const st = got.body?.data?.status;
      record('C1-正常内容不受影响', st === 0, `ADMIN 正常帖 → status=${st}（期望 0）`);
      await jpost('/posts/' + postId + '/delete', {}, auth).catch(() => {});
    }
  }

  // ======== C2 举报闭环（举报已存在的公开帖，避免 A2 发帖限频干扰） ========
  {
    // 1) 取一个公开帖作为举报目标
    const posts = await jget('/posts?current=1&size=1');
    const postId = posts.body?.data?.records?.[0]?.id;
    if (!postId) {
      record('C2-提交举报', false, '没有可用公开帖，跳过');
    } else {
      const rep = await jpost('/reports', { targetType: 1, targetId: postId, reason: 'C2 自动化测试举报' }, auth);
      const reportId = rep.body?.data?.id;
      record('C2-提交举报', !!reportId, `reportId=${reportId} code=${rep.body?.code}`);

      // 2) 我的举报列表 → 待处理可见（后端返回原始 status，statusText 由前端映射）
      const STATUS_TEXT = ['待处理', '已处理(违规)', '已驳回'];
      const mine1 = await jget('/reports/mine?current=1&size=10', auth);
      const item = (mine1.body?.data?.records || []).find(x => x.id === reportId);
      record('C2-我的举报-待处理可见',
          item && item.status === 0 && STATUS_TEXT[item.status] === '待处理',
          item ? `status=${item.status} targetTitle=${item.targetTitle}` : '未找到');

      // 3) 按状态过滤 status=0 能查到
      const mine0 = await jget('/reports/mine?status=0', auth);
      const hit = (mine0.body?.data?.records || []).some(x => x.id === reportId);
      record('C2-我的举报-状态过滤', hit, 'filter status=0 命中');

      // 4) 处理举报（驳回）→ 我方列表显示已驳回 + 处理说明
      await jpost(`/admin/reports/${reportId}/handle`, { status: 2, handleNote: 'C2 测试：证据不足驳回' }, auth);
      const mine2 = await jget('/reports/mine?status=2', auth);
      const done = (mine2.body?.data?.records || []).find(x => x.id === reportId);
      record('C2-处理后状态回显',
          done && done.status === 2 && !!done.handleNote,
          done ? `statusText=${done.statusText} note=${done.handleNote}` : '未找到');
      // 注意：举报目标是别人的真实公开帖，不做删除清理；举报用「驳回」方式闭环，无副作用
    }
  }

  // ======== 汇总 ========
  const total = results.length;
  const pass = results.filter(r => r.pass).length;
  console.log(`\n========= C1/C2 验证汇总 =========`);
  console.log(`${pass}/${total} 通过`);
  if (pass < total) {
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail}`));
    process.exit(1);
  }
})().catch(e => { console.error('test crashed:', e); process.exit(2); });
