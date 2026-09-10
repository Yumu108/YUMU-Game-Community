// YUMU 游戏社区 · 接口性能探查（第5阶段·性能测试）
// 运行：node api-perf-test.mjs
// 说明：对核心只读接口做 N 次采样，统计 平均 / P95 / 最大 耗时(ms)，用于发现慢接口。
const BASE = 'http://localhost:8080/api'
const N = 30

async function timeit(fn) {
  const t0 = performance.now()
  await fn()
  return performance.now() - t0
}
function stats(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const avg = s.reduce((a, b) => a + b, 0) / s.length
  const p95 = s[Math.floor(s.length * 0.95)]
  return { avg: +avg.toFixed(2), p95: +p95.toFixed(2), max: +s[s.length - 1].toFixed(2), min: +s[0].toFixed(2) }
}

async function main() {
  const samples = { 'GET /boards': [], 'GET /posts?sort=latest': [], 'GET /posts?sort=hot': [], 'GET /posts/{id}': [], 'GET /search?keyword=游戏': [], 'GET /stats/hot-posts': [] }
  // 取一个真实帖子 id
  const plist = await (await fetch(`${BASE}/posts?sort=latest&current=1&size=1`)).json()
  const pid = plist?.data?.records?.[0]?.id
  console.log(`采样次数 N=${N}，基准帖子 id=${pid}\n`)

  for (let i = 0; i < N; i++) {
    samples['GET /boards'].push(await timeit(() => fetch(`${BASE}/boards`)))
    samples['GET /posts?sort=latest'].push(await timeit(() => fetch(`${BASE}/posts?sort=latest&current=1&size=10`)))
    samples['GET /posts?sort=hot'].push(await timeit(() => fetch(`${BASE}/posts?sort=hot&current=1&size=10`)))
    if (pid) samples['GET /posts/{id}'].push(await timeit(() => fetch(`${BASE}/posts/${pid}`)))
    samples['GET /search?keyword=游戏'].push(await timeit(() => fetch(`${BASE}/search?keyword=%E6%B8%B8%E6%88%8F&type=all`)))
    samples['GET /stats/hot-posts'].push(await timeit(() => fetch(`${BASE}/stats/hot-posts?size=10`)))
  }

  console.log('接口'.padEnd(30), '平均ms', 'P95ms', '最大ms', '最小ms')
  console.log('-'.repeat(70))
  for (const [k, v] of Object.entries(samples)) {
    if (v.length === 0) continue
    const s = stats(v)
    console.log(k.padEnd(28), String(s.avg).padStart(7), String(s.p95).padStart(7), String(s.max).padStart(7), String(s.min).padStart(7))
  }
  console.log('\n（本机 MySQL8 + JDK21 本地环回，数值仅为相对参考，非压测容量结论）')
}
main().catch(e => { console.error(e); process.exit(1) })
