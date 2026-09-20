/**
 * 接口「静默失败」的守卫 —— 纯函数，零依赖（可在 Node 里直接单测，见 tests/apiGuard.test.mjs）。
 *
 * ── 为什么会有这个文件（2026-09-20 真机事故复盘）─────────────────────
 * 现象：真机小程序上「攻略 / 资讯」按平台分类**全是 0**、「游戏库」的「全部」也是 0
 *   且类型条整个空掉（连一个 chip 都没有）。
 *
 * 挖出来的成因是一条**伪装成成功的空响应**：
 *
 *   GET /api/games?current=1&size=100&keyword=undefined&platform=undefined&genre=undefined
 *   → {"code":200,"data":{"records":[],"total":0}}        ← HTTP 200 · code 200 · 但空数组
 *
 * 后端把 `platform=undefined` 当成一个**真实筛选值**（字符串 "undefined"）⇒ 一条都匹配不上，
 * 却仍是老老实实的 200 + total:0。而 `utils/guideIndex.js#ensureGameMeta` 当时**只看有没有 records**，
 * 不校验内容 ⇒ 把「80 款游戏」缓存成了「0 款游戏」（`platforms:{'':0}`、`genres:[]`），TTL **24 小时**：
 *   · 游戏库：「全部 0」+ 类型 chips 全空（genres 为空数组）；
 *   · 帖子索引拿不到 `gameId → platform` 映射 ⇒ 254 篇帖子的平台归属全落成 `''` ⇒ 每个平台都是 0。
 * 更糟的是帖子索引 TTL 只有 10 分钟，会**不停地**用这份坏映射重建 —— **自愈不了，一坏就是一整天**。
 *
 * 于是这里立两条守卫，对应请求侧与响应侧两条修法：
 *   ① `cleanParams`：**请求侧** —— query 里绝不放 `undefined` / `null`
 *      （不同运行时序列化行为不一致：H5 变空串、小程序可能变字符串 "undefined"）；
 *   ② `isPagedBody` / `isUsableMeta` / `isUsableIndex`：**响应侧** ——
 *      分页体必须是对象且 `records` 是数组；**空结果一律不写缓存**
 *      （宁可下次重新同步，也不要把「空」当有效数据存一天）。
 *
 * ⚠️ 这个文件**刻意不 import 任何东西**：`api/config.js` 用了条件编译（`// #ifdef H5`），
 *   在普通 Node 里两段都会生效 ⇒ 声明重复 ⇒ 语法错误。保持零依赖才能直接单测。
 */

/**
 * 清掉 query 里的 `undefined` / `null`（**保留空串**）。
 *
 * 为什么不连空串一起删：实测本后端把 `platform=` 与「不带该参数」视为同一件事
 * （`/games?...&platform=&genre=&keyword=` 返回全部 80 款），保留空串语义不变；
 * 而 `undefined` 一旦被序列化成字符串 `"undefined"`，就会变成**真筛选**并把结果清零。
 * 这个差异正是本事故的入口，所以只收口明确有害的那一种。
 *
 * @param {object} [data]
 * @returns {object} 新对象（**不改动入参**）
 */
export function cleanParams(data) {
  const out = {}
  if (!data || typeof data !== 'object') return out
  Object.keys(data).forEach((k) => {
    const v = data[k]
    if (v === undefined || v === null) return
    out[k] = v
  })
  return out
}

/**
 * 是不是一个**分页体**。
 *
 * 🚨 判据必须是「`records` 是数组」，不能只判 `res && res.records`：
 *   网关兜底页（HTML）、鉴权失败体（`{code:401,data:null}`）、直出的裸数组
 *   都会让 `res.records` 落成 `undefined` —— 于是 `recs = []`，
 *   一个**响应异常**就被读成了「这里本来就没有数据」。这正是本次事故的读法。
 *
 * @param {any} res
 * @returns {boolean}
 */
export function isPagedBody(res) {
  return !!res && typeof res === 'object' && !Array.isArray(res) && Array.isArray(res.records)
}

/**
 * 把 `/games` 的记录折成三样东西：
 *   · `map`       `gameId → platform`（帖子归类的**唯一依据**）
 *   · `genres`    类型清单（带收录量，按数量倒序）
 *   · `platforms` 各平台的游戏款数（含 `''` = 收录总数，游戏库「全部」档用）
 *
 * @param {Array} records
 * @returns {{map:Record<string,string>, genres:Array<{name:string,count:number}>, platforms:Record<string,number>, mapped:number}}
 */
export function foldGameRecords(records) {
  const list = Array.isArray(records) ? records : []
  const map = {}
  const genreCount = {}
  const platforms = {}
  let mapped = 0

  list.forEach((g) => {
    if (!g || g.id == null) return
    mapped += 1
    const plat = g.platform || ''
    map[g.id] = plat
    if (plat) platforms[plat] = (platforms[plat] || 0) + 1
    const ge = String(g.genre || '').trim()
    if (ge) genreCount[ge] = (genreCount[ge] || 0) + 1
  })

  const genres = Object.keys(genreCount)
    .map((name) => ({ name, count: genreCount[name] }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1))

  platforms[''] = mapped // 「全部」= 本次实际收到的游戏款数（与 map 同源，不会各说各话）
  return { map, genres, platforms, mapped }
}

/**
 * 游戏元数据缓存是否**可用**。
 *
 * 🚨 关键在「`map` 非空」：一条空的映射不是「部分数据」，而是**功能整体失效**
 *   （所有帖子都会归成平台未知）。历史坏缓存（`map:{}`）因此会在读的时候被直接判废、
 *   重新同步 —— 这既是防御，也是**已中毒设备的自愈通道**。
 *
 * @param {{at?:number, map?:object, genres?:Array, platforms?:object}|null} cached
 * @param {number} [ttl] 毫秒；不传则只校验形态（由调用方判过期）
 * @returns {boolean}
 */
export function isUsableMeta(cached, ttl) {
  if (!cached || typeof cached !== 'object') return false
  if (!cached.map || typeof cached.map !== 'object') return false
  if (Object.keys(cached.map).length === 0) return false
  if (ttl != null && !(Date.now() - Number(cached.at || 0) < ttl)) return false
  return true
}

/** 帖子索引缓存是否可用（`items` 必须是非空数组） */
export function isUsableIndex(cached) {
  return !!cached && Array.isArray(cached.items) && cached.items.length > 0
}

/**
 * 失败重试 —— 只为**瞬时故障**兜底（真机网络抖动 / 后端重启那几百毫秒）。
 *
 * ⚠️ 不做无限重试、不做指数退避：端内索引是首屏路径，用户等不起。
 *   重试仍然失败 ⇒ 走页面的失败态 + 重试按钮 + 上一次内容回退。
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{times?:number, delay?:number}} [opt]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { times = 2, delay = 600 } = {}) {
  let last
  for (let i = 0; i < Math.max(1, times); i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i < times - 1) await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw last
}
