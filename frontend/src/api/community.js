// ============================================================================
// 社区 API 服务层 —— 已接入真实后端（Spring Boot @ /api）
//
// 设计原则：函数签名与字段结构与组件消费方式保持一致，组件代码无需改动。
// 后端返回 Result<T> 包裹体，request 拦截器已把响应脱壳为 Result（即 res = {code,message,data}），
// 因此本层统一从 res.data 取值，并把后端字段映射成组件期望的命名（如 icon→emoji、authorName→author）。
//
// 真实接入：boards / posts(list·detail·create·like·favorite) / replies / auth / follow / stats / search
// ============================================================================
import request from '@/api/request'

// ---- 后端 PostVO -> 前端 PostCard / PostDetail 期望字段 ----
function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[#*_>`~]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
function normalizeTag(t) {
  if (!t) return null
  return { id: t.id, name: t.name, count: t.useCount || 0 }
}
function normalizePost(p) {
  if (!p) return null
  const createdAt = (p.createdAt || '').replace('T', ' ').slice(0, 16)
  const resubmitAt = (p.resubmitAt || '').replace('T', ' ').slice(0, 16)
  const text = stripHtml(p.content)
  return {
    id: p.id,
    userId: p.userId,
    boardId: p.boardId,
    title: p.title,
    content: p.content,
    excerpt: p.summary || (text ? text.slice(0, 60) : p.title),
    boardName: p.boardName,
    boardTag: p.boardName, // 用板块名兜底分类标签
    author: p.authorName,
    avatar: p.authorAvatar || (p.authorName ? p.authorName.charAt(0) : '游'),
    cover: p.cover,
    coverEmoji: '🎮',
    isTop: !!p.isTop,
    isEssence: !!p.isEssence,
    isHot: false,
    viewCount: p.viewCount || 0,
    replyCount: p.replyCount || 0,
    likeCount: p.likeCount || 0,
    status: p.status,
    createdAt,
    liked: p.liked,
    favorited: p.favorited,
    // 关联游戏（游戏库联动：帖子可挂载某个游戏条目）
    gameId: p.gameId || null,
    gameName: p.gameName || '',
    gameCover: p.gameCover || '',
    tags: (p.tags || []).map(normalizeTag),
    // 审核相关（驳回时会用到）
    rejectReason: p.rejectReason || '',
    reviewerId: p.reviewerId || null,
    // 待重审标记：被驳回后重新提交审核的时间（前端据此显示「待重审」）
    resubmitAt,
    // 作者身份徽章 + 活跃度等级
    authorBadge: p.authorBadge || null,         // ADMIN / MODERATOR / SUB_MODERATOR
    authorBadgeColor: p.authorBadgeColor || null,
    authorModeratorGameNames: p.authorModeratorGameNames || [],  // 1.2 起：版主负责游戏名
    authorLevel: p.authorLevel || 1,
    authorLevelTitle: p.authorLevelTitle || '🥉初出茅庐'
  }
}

// ---- 游戏库（Game） ----
function normalizeGame(g) {
  if (!g) return null
  return {
    id: g.id,
    name: g.name || '',
    cover: g.cover || '',
    platform: g.platform || '',
    genre: g.genre || '',
    description: g.description || '',
    developer: g.developer || '',
    publisher: g.publisher || '',
    releaseDate: g.releaseDate ? String(g.releaseDate).slice(0, 10) : '',
    postCount: g.postCount || 0,
    sort: g.sort || 0,
    status: g.status == null ? 0 : g.status,
    createdAt: (g.createdAt || '').toString().replace('T', ' ').slice(0, 16)
  }
}

// ---- 板块树 -> { parents, childrenOf }（SideNav / Editor 期望结构） ----
function normalizeBoard(b) {
  return {
    id: b.id,
    name: b.name,
    emoji: b.icon,
    desc: b.description,
    postCount: b.postCount || 0,
    sort: b.sort
  }
}
function normalizeBoards(tree) {
  const parents = (tree || []).map(normalizeBoard)
  const childrenOf = (pid) => {
    const p = (tree || []).find((b) => b.id === Number(pid) || b.id === pid)
    return (p && p.children ? p.children : []).map(normalizeBoard)
  }
  return { parents, childrenOf }
}

// ---- 回帖：扁平→平铺式楼中楼（4399 / B 站 / NGA / 知乎风格） ----
// 9-07 第三次重构：取消无限嵌套缩进，改为「只到 2 层」：
//   - 顶级 replyToId=null 的回复 = 一级主回复
//   - 任何 replyToId 非空的子回复（不论楼中楼链 A→B→C 多深）都直接挂到「一级主回复」的 children 里
//   - 视觉上同一级主回复下平铺展示全部子评论，靠「回复 @昵称」前缀表达被回复对象
//   - 优点：阅读无障碍（无缩进文字始终左对齐，手机也舒适）；任意层数都不"套娃"；折叠简单
// 平铺逻辑：对每个 reply 沿 replyToId 链向上找根（replyToId=null 或不在 map 中），挂到根的 children。
function normalizeReply(r) {
  return {
    id: r.id,
    postId: r.postId,
    userId: r.userId,
    author: r.authorName,
    avatar: r.authorAvatar || (r.authorName ? r.authorName.charAt(0) : '游'),
    content: r.content,
    likeCount: r.likeCount || 0,
    liked: !!r.liked,
    createdAt: (r.createdAt || '').replace('T', ' ').slice(0, 16),
    replyToId: r.replyToId,
    replyToName: r.replyToName,
    replyToUserId: r.replyToUserId,
    authorBadge: r.authorBadge || null,
    authorBadgeColor: r.authorBadgeColor || null,
    authorModeratorGameNames: r.authorModeratorGameNames || [],
    authorLevel: r.authorLevel || 1,
    authorLevelTitle: r.authorLevelTitle || '',
    children: [] // 装的是子评论（不递归挂载）
  }
}

function normalizeReplies(flat) {
  const nodes = (flat || []).map(normalizeReply)
  const map = {}
  nodes.forEach((n) => { map[n.id] = n })
  const roots = []
  nodes.forEach((n) => {
    if (n.replyToId && map[n.replyToId]) {
      // 沿 replyToId 链向上找根：直到 replyToId=null 或不在当前 map 中
      let cur = n
      const seen = new Set([n.id]) // 防成环
      while (cur.replyToId && map[cur.replyToId] && !seen.has(cur.replyToId)) {
        seen.add(cur.replyToId)
        cur = map[cur.replyToId]
      }
      // cur 即根级主回复，把 n 平铺挂到它的 children
      cur.children.push(n)
    } else {
      // 顶级主回复（replyToId=null 或被回复者已不在返回中）
      roots.push(n)
    }
  })
  return roots
}

// ---- 板块 ----
// 1.2：支持 gameId 过滤（选中游戏后只展示该游戏在每个板块的帖数；不传=全站总数）
export async function getBoards(gameId = null) {
  const res = await request.get('/boards', {
    params: { gameId: gameId || undefined }
  })
  return normalizeBoards(res.data)
}

export async function getBoard(id) {
  const res = await request.get(`/boards/${id}`)
  return res.data ? normalizeBoard(res.data) : null
}

// ---- 帖子（分页） ----
// 1.2：支持 gameId 过滤（进入游戏库选中某游戏后只展示该游戏帖子；不传=全部游戏）
export async function getPosts({ boardId = null, gameId = null, sort = 'latest', current = 1, size = 10 } = {}) {
  const res = await request.get('/posts', {
    params: { boardId: boardId || undefined, gameId: gameId || undefined, sort, current, size }
  })
  const page = res.data || {}
  const records = page.records || []
  return {
    records: records.map(normalizePost),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}

export async function getPostDetail(id) {
  const res = await request.get(`/posts/${id}`)
  return normalizePost(res.data)
}

/**
 * 关注流：仅当前用户关注的人发的可见帖，支持排序二次筛选（all/latest/hot/essence/reply/favorite）。需登录。
 */
export async function getFollowingFeed({ sort = 'latest', current = 1, size = 10 } = {}) {
  const res = await request.get('/posts/following', { params: { sort, current, size } })
  const page = res.data || {}
  const records = page.records || []
  return {
    records: records.map(normalizePost),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}

export async function addPost({ title, boardId, content, cover, tags = [], gameId = null }) {
  const res = await request.post('/posts', { boardId, title, content, cover, tags, gameId })
  return { id: res.data.id }
}

/**
 * 编辑帖子（作者本人 / ADMIN）。
 * 入参同 addPost（不含 status/isTop/isEssence 等审核字段）。
 * 后端保留原 status/isTop/isEssence，不允许通过此接口绕审。
 */
export async function updatePost(id, { title, boardId, content, cover = '', tags, gameId = null }) {
  const res = await request.put(`/posts/${id}`, { boardId, title, content, cover, tags, gameId })
  return res.data
}

// ---- 游戏库（/games） ----
// GET /games?keyword=&platform=&genre=&current=&size= 分页游戏列表
export async function getGames({ keyword = '', platform = '', genre = '', current = 1, size = 12 } = {}) {
  const res = await request.get('/games', {
    params: {
      keyword: keyword || undefined,
      platform: platform || undefined,
      genre: genre || undefined,
      current,
      size
    }
  })
  const page = res.data || {}
  const records = page.records || []
  return {
    records: records.map(normalizeGame),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
// GET /games/{id} 游戏详情
export async function getGameDetail(id) {
  const res = await request.get(`/games/${id}`)
  return normalizeGame(res.data)
}
// GET /games/hot 热门游戏（按帖子数/热度）
export async function getHotGames(limit = 8) {
  const res = await request.get('/games/hot', { params: { limit } })
  return (res.data || []).map(normalizeGame)
}
// GET /games/{id}/posts 某游戏下帖子（分页）
export async function getGamePosts(id, { current = 1, size = 10 } = {}) {
  const res = await request.get(`/games/${id}/posts`, { params: { current, size } })
  const page = res.data || {}
  return {
    records: (page.records || []).map(normalizePost),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
// GET /games/{id}/active-users 某游戏活跃玩家（按在该游戏发帖数降序）
export async function getGameActiveUsers(id, limit = 6) {
  const res = await request.get(`/games/${id}/active-users`, { params: { limit } })
  return (res.data || []).map((u) => ({
    id: u.id,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    postCount: u.postCount != null ? u.postCount : (u.post_count || 0),
    activityLevel: u.activityLevel,
    activityTitle: u.activityTitle
  }))
}
// GET /games/{id}/moderators 某游戏的版主列表（含负责板块名数组）
export async function getGameModerators(id) {
  const res = await request.get(`/games/${id}/moderators`)
  return (res.data || []).map((m) => ({
    id: m.id,
    nickname: m.nickname,
    avatar: m.avatar,
    bio: m.bio,
    activityLevel: m.activityLevel,
    activityTitle: m.activityTitle,
    boards: Array.isArray(m.boards) ? m.boards : []
  }))
}

// ---- 积分 / 签到（/points） ----
// POST /points/sign-in 返回 { signed, continuousDays, points, totalPoints }
export async function signIn() {
  const res = await request.post('/points/sign-in')
  return res.data || {}
}
// GET /points/status 返回 { totalPoints, signedToday }
export async function getPointsStatus() {
  const res = await request.get('/points/status')
  return res.data || { totalPoints: 0, signedToday: false }
}
// GET /points/logs 分页积分明细
export async function getPointsLogs({ current = 1, size = 20 } = {}) {
  const res = await request.get('/points/logs', { params: { current, size } })
  const page = res.data || {}
  const typeText = { 1: '每日签到', 2: '发布帖子', 3: '发表回复', 4: '获得点赞', 5: '精华奖励', 6: '其它' }
  return {
    records: (page.records || []).map((l) => ({
      id: l.id,
      type: l.type,
      typeText: typeText[l.type] || '其它',
      delta: l.delta || 0,
      balanceAfter: l.balanceAfter || 0,
      description: l.description || '',
      createdAt: (l.createdAt || '').toString().replace('T', ' ').slice(0, 16)
    })),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}

// ---- 内容精选（/picks） ----
// GET /picks/daily 每日精选（PostVO 列表）
export async function getDailyPicks() {
  const res = await request.get('/picks/daily')
  return (res.data || []).map(normalizePost)
}
// GET /picks/weekly 每周热门（PostVO 列表）
export async function getWeeklyPicks() {
  const res = await request.get('/picks/weekly')
  return (res.data || []).map(normalizePost)
}

// ---- 订阅 / 个性化发现（/subscribe，需登录） ----
// GET /subscribe/list 返回 { boards:[{id,name,icon}], keywords:[...] }
export async function getSubscriptions() {
  const res = await request.get('/subscribe/list')
  const d = res.data || {}
  return { boards: d.boards || [], keywords: d.keywords || [] }
}
// POST /subscribe/board/{boardId} 切换板块订阅，返回 { followed }
export async function toggleBoardSubscription(boardId) {
  const res = await request.post(`/subscribe/board/${boardId}`)
  return res.data || { followed: false }
}
// POST /subscribe/keyword { keyword } 切换关键词订阅，返回 { followed }
export async function toggleKeywordSubscription(keyword) {
  const res = await request.post('/subscribe/keyword', { keyword })
  return res.data || { followed: false }
}
// GET /subscribe/feed 个性化订阅流（分页 PostVO）
export async function getSubscriptionFeed({ current = 1, size = 10 } = {}) {
  const res = await request.get('/subscribe/feed', { params: { current, size } })
  const page = res.data || {}
  return {
    records: (page.records || []).map(normalizePost),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}

// ---- 图片上传（文件上传 -> URL；替代早期的 base64 内嵌） ----
// 后端 POST /upload 接收 multipart 图片，落盘后返回可访问 URL（/api/files/{filename}）
export async function uploadImage(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await request.post('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return res.data // 返回图片 URL 字符串
}

export async function toggleLike(id) {
  const res = await request.post(`/posts/${id}/like`)
  return res.data // { liked, likeCount }
}

export async function toggleFavorite(id) {
  const res = await request.post(`/posts/${id}/favorite`)
  return res.data // { favorited }
}

// 我的帖子：按 userId 拉取（作者本人含隐藏/待审核帖，便于管理）
export async function getMyPosts(userId, { current = 1, size = 100 } = {}) {
  if (!userId) return []
  const res = await request.get(`/users/${userId}/posts`, { params: { current, size } })
  const records = (res.data && res.data.records) || []
  return records.map(normalizePost)
}

// ---- 帖子管理（作者/管理员） ----
export async function deletePost(id) {
  const res = await request.delete(`/posts/${id}`)
  return res.data // { deleted }
}
export async function hidePost(id) {
  const res = await request.post(`/posts/${id}/hide`)
  return res.data // { status }
}
export async function restorePost(id) {
  const res = await request.post(`/posts/${id}/restore`)
  return res.data // { status }
}

// ---- 标签（/tags） ----
export async function getTags() {
  const res = await request.get('/tags')
  return (res.data || []).map(normalizeTag)
}
export async function getHotTags(limit = 10) {
  const res = await request.get('/tags/hot', { params: { limit } })
  return (res.data || []).map(normalizeTag)
}
export async function getTag(id) {
  const res = await request.get(`/tags/${id}`)
  return normalizeTag(res.data)
}
export async function getPostTags(postId) {
  const res = await request.get(`/posts/${postId}/tags`)
  return (res.data || []).map(normalizeTag)
}
export async function getPostsByTag(tagId, { current = 1, size = 10 } = {}) {
  const res = await request.get(`/tags/${tagId}/posts`, { params: { current, size } })
  const page = res.data || {}
  return {
    records: (page.records || []).map(normalizePost),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
export async function setPostTags(postId, tags) {
  await request.put(`/posts/${postId}/tags`, { tags })
  return true
}

// 我的收藏：已登录时后端会在 PostVO 填充 favorited，据此过滤
export async function getFavorites() {
  const res = await request.get('/posts', { params: { current: 1, size: 200 } })
  const records = (res.data && res.data.records) || []
  return records.filter((p) => p.favorited === true).map(normalizePost)
}

// ---- 回帖 ----
export async function getReplies(postId) {
  const res = await request.get(`/posts/${postId}/replies`)
  return normalizeReplies(res.data)
}

export async function addReply(postId, { content, replyToId = null }) {
  const res = await request.post(`/posts/${postId}/replies`, {
    content,
    // 仅在有父回复时携带，后端 CreateReplyRequest.replyToId 非空即视为楼中楼
    ...(replyToId ? { replyToId } : {})
  })
  return res.data // { id }
}

/**
 * 9-07 楼中楼优化：切换对某条回复的点赞。返回 { liked, likeCount }。
 * 后端 POST /posts/replies/{id}/like（参见 ReplyController）。
 */
export async function toggleReplyLike(replyId) {
  const res = await request.post(`/posts/replies/${replyId}/like`)
  return res.data // { liked, likeCount }
}

/**
 * 删除自己的回帖（软删除）。权限：仅回复作者本人或 ADMIN；版主无权（走审核隐藏接口）。
 * 删除后：帖子 reply_count -1，楼中楼场景下被回复者收到「xxx 删除了对你的回复」通知。
 */
export async function deleteReply(id) {
  const res = await request.delete(`/posts/replies/${id}`)
  return res.data // { deleted: true }
}

// ---- 认证（真实后端） ----
export async function login({ username, password }) {
  const res = await request.post('/auth/login', { username, password })
  return res.data // { user, token }
}
export async function register({ username, password, nickname }) {
  const res = await request.post('/auth/register', { username, password, nickname })
  return res.data // { user, token }
}
export async function getMe() {
  const res = await request.get('/auth/me')
  return res.data
}

// ---- 关注（真实后端 /follow） ----
function normalizeFollowUser(u) {
  if (!u) return null
  return {
    id: u.id,
    name: u.nickname || u.username || '未知用户',
    avatar: u.avatar || (u.nickname ? u.nickname.charAt(0) : '游'),
    bio: u.bio || '',
    isFollowing: !!u.isFollowing
  }
}
export async function toggleFollow(targetUserId) {
  const res = await request.post(`/follow/${targetUserId}`)
  return res.data // { followed }
}
export async function checkFollow(targetUserId) {
  const res = await request.get(`/follow/check/${targetUserId}`)
  return res.data // { followed }
}
export async function getFollowing({ current = 1, size = 20 } = {}) {
  const res = await request.get('/follow/following', { params: { current, size } })
  const page = res.data || {}
  return {
    records: (page.records || []).map(normalizeFollowUser),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
export async function getFollowers({ current = 1, size = 20 } = {}) {
  const res = await request.get('/follow/followers', { params: { current, size } })
  const page = res.data || {}
  return {
    records: (page.records || []).map(normalizeFollowUser),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
export async function getFollowCounts(userId) {
  const res = await request.get(`/follow/counts/${userId}`)
  return res.data || { following: 0, followers: 0 }
}

// ---- 右栏真实统计（/stats） ----
export async function getHotList() {
  const res = await request.get('/stats/hot-posts', { params: { limit: 8 } })
  return (res.data || []).map((p) => ({
    id: p.id,
    title: p.title,
    heat: (p.replyCount || 0) * 2 + (p.likeCount || 0)
  }))
}

export async function getActiveUsers() {
  const res = await request.get('/stats/active-users', { params: { limit: 8 } })
  const PLAIN_TITLES = { 1: '初出茅庐', 2: '活跃玩家', 3: '资深玩家', 4: '社区精英', 5: '传说玩家' }
  return (res.data || []).map((u) => {
    const lvl = u.activityLevel || 1
    const cleanBadge = (s) => (s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, '').trim()
    const badge = cleanBadge(u.activityTitle) || PLAIN_TITLES[lvl] || `${u.postCount || 0} 帖`
    return {
      id: u.id,
      name: u.nickname || '玩家',
      avatar: (u.nickname || '玩').charAt(0),
      postCount: u.postCount || 0,
      badge,
      level: lvl
    }
  })
}

// ---- 搜索（/search?keyword=&type=all|post|board|user） ----
function shapePosts(page) {
  const p = page || {}
  return {
    records: (p.records || []).map(normalizePost),
    total: p.total || 0,
    pages: p.pages || 0,
    current: p.current || 1,
    size: p.size || 10
  }
}
export async function search({ keyword, type = 'all', current = 1, size = 10 } = {}) {
  const res = await request.get('/search', {
    params: { keyword, type, current, size }
  })
  const d = res.data || {}
  const out = { type, postsPage: null, boards: [], users: [], games: [] }
  if (type === 'post') {
    out.postsPage = shapePosts(d)
  } else if (type === 'board') {
    out.boards = (d || []).map(normalizeBoard)
  } else if (type === 'user') {
    out.users = (d || []).map(normalizeFollowUser)
  } else if (type === 'game') {
    out.games = (d || []).map(normalizeGame)
  } else {
    out.postsPage = shapePosts(d.posts)
    out.boards = (d.boards || []).map(normalizeBoard)
    out.users = (d.users || []).map(normalizeFollowUser)
    out.games = (d.games || []).map(normalizeGame)
  }
  return out
}

// ---- 用户主页（/users/{id}） ----
export async function getUserProfile(id) {
  const res = await request.get(`/users/${id}`)
  const p = res.data || {}
  return {
    id: p.id,
    username: p.username,
    nickname: p.nickname,
    avatar: p.avatar,
    bio: p.bio || '',
    hobbies: p.hobbies || '',
    favoriteBoardIds: p.favoriteBoardIds || '',
    favoriteGameIds: p.favoriteGameIds || '',                  // 1.2 起：游戏爱好（逗号分隔 gameId）
    favoriteGames: (p.favoriteGames || []).map(normalizeGame), // 1.2 起：后端解析后的游戏列表（按热度排序）
    gender: p.gender,
    followingCount: p.followingCount || 0,
    followersCount: p.followersCount || 0,
    postCount: p.postCount || 0,
    points: p.points || 0,
    likeReceivedCount: p.likeReceivedCount || 0,
    isFollowed: !!p.isFollowed,
    roles: p.roles || [],
    badge: p.badge || null,
    moderatorBoardIds: p.moderatorBoardIds || [],
    moderatorBoardNames: p.moderatorBoardNames || [],
    moderatorGameNames: p.moderatorGameNames || [],    // 1.2 起：负责游戏名（徽章显示用）
    posts: (p.posts || []).map(normalizePost)
  }
}

// ---- 修改个人资料（昵称/头像/签名/爱好/常看板块） ----
export async function updateProfile(payload) {
  const res = await request.put('/users/me/profile', payload)
  return res.data || {}
}

// ---- 修改密码 ----
export async function updatePassword({ oldPassword, newPassword }) {
  const res = await request.put('/users/me/password', { oldPassword, newPassword })
  return res.data
}

// ---- 修改登录账号（用户名，每年一次） ----
export async function updateUsername({ username }) {
  const res = await request.put('/users/me/username', { username })
  return res.data
}

// ---- 私信（/messages） ----
export async function getConversations() {
  const res = await request.get('/messages/conversations')
  return (res.data || []).map((c) => ({
    userId: c.userId,
    name: c.nickname || '未知用户',
    avatar: c.avatar || (c.nickname || '?').charAt(0),
    lastMessage: c.lastMessage || '',
    lastTime: (c.lastTime || '').replace('T', ' ').slice(0, 16),
    unread: c.unread || 0
  }))
}
export async function getMessages(userId, { current = 1, size = 30 } = {}) {
  const res = await request.get(`/messages/${userId}`, { params: { current, size } })
  const page = res.data || {}
  return {
    records: (page.records || []).map((m) => ({
      id: m.id,
      fromUserId: m.fromUserId,
      toUserId: m.toUserId,
      fromName: m.fromNickname || '未知用户',
      content: m.content,
      isRead: m.isRead,
      createdAt: (m.createdAt || '').replace('T', ' ').slice(0, 16)
    })),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
export async function sendMessage({ toUserId, content }) {
  const res = await request.post('/messages', { toUserId, content })
  return res.data // { id }
}
export async function markMessagesRead(userId) {
  await request.post(`/messages/read/${userId}`)
  return true
}

// 私信未读总数：后端暂无聚合端点，由会话列表的 unread 累加
export async function getUnreadMessageCount() {
  const res = await request.get('/messages/conversations')
  return ((res.data || []).reduce((sum, c) => sum + (c.unread || 0), 0)) || 0
}

// ---- 通知（/notifications） ----
export async function getNotifications() {
  const res = await request.get('/notifications')
  return (res.data || []).map((n) => ({
    id: n.id,
    type: n.type,
    senderId: n.senderId,
    senderName: n.senderNickname || '系统',
    targetType: n.targetType,
    targetId: n.targetId,
    content: n.content,
    isRead: n.isRead,
    createdAt: (n.createdAt || '').replace('T', ' ').slice(0, 16)
  }))
}
export async function getUnreadCount() {
  const res = await request.get('/notifications/unread-count')
  return (res.data && res.data.count) || 0
}
export async function markNotificationRead(id) {
  await request.post('/notifications/read', null, id ? { params: { id } } : {})
  return true
}
// 清空已读：types 为空清全部，否则按 Tab 类型范围清（后端只删 is_read=1）
export async function clearReadNotifications(types) {
  const params = types && types.length ? { types: types.join(',') } : {}
  await request.post('/notifications/clear-read', null, { params })
  return true
}

// ---- 举报（登录用户即可提交） ----
export async function submitReport({ targetType, targetId, reason }) {
  const res = await request.post('/reports', { targetType, targetId, reason })
  return res.data // { id }
}

// C2 举报闭环：我的举报（当前用户自己的举报记录 + 处理状态）
// GET /reports/mine?status=&current=&size=
export async function listMyReports({ status = null, current = 1, size = 10 } = {}) {
  const res = await request.get('/reports/mine', {
    params: { status: status == null ? undefined : status, current, size }
  })
  const page = res.data || {}
  const statusText = ['待处理', '已处理(违规)', '已驳回']
  const typeText = { 1: '帖子', 2: '回复', 3: '用户' }
  return {
    records: (page.records || []).map((r) => ({
      ...normalizeReport(r),
      targetTypeText: typeText[r.targetType] || '未知',
      statusText: statusText[r.status] ?? '未知'
    })),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}

// ---- 后台举报队列 ----
// 后端 ReportVO 已带 targetTitle（帖子/回复/用户三种摘要）+ postId / replyId / replyFloor（用于「查看原文」跳转）
function normalizeReport(r) {
  return {
    id: r.id,
    reporterId: r.reporterId,
    reporterName: r.reporterName,
    targetType: r.targetType,
    targetId: r.targetId,
    targetTitle: r.targetTitle,
    reason: r.reason,
    status: r.status,
    handleNote: r.handleNote,
    handlerId: r.handlerId,
    createdAt: (r.createdAt || '').replace('T', ' ').slice(0, 16),
    postId: r.postId || null,
    replyId: r.replyId || null,
    replyFloor: r.replyFloor || null
  }
}

// ---- 管理/审核后台（仅 ADMIN，后端做角色越权校验） ----
export async function adminPinPost(id) {
  const res = await request.post(`/admin/posts/${id}/pin`)
  return res.data // { isTop }
}
export async function adminEssencePost(id) {
  const res = await request.post(`/admin/posts/${id}/essence`)
  return res.data // { isEssence }
}
export async function adminHidePost(id) {
  const res = await request.post(`/admin/posts/${id}/hide`)
  return res.data // { status }
}
export async function adminRestorePost(id) {
  const res = await request.post(`/admin/posts/${id}/restore`)
  return res.data // { status }
}
export async function listReports({ status = 0, current = 1, size = 20 } = {}) {
  const res = await request.get('/admin/reports', {
    params: { status: status == null ? undefined : status, current, size }
  })
  const page = res.data || {}
  const statusText = ['待处理', '已处理(违规)', '已驳回']
  const typeText = { 1: '帖子', 2: '回复', 3: '用户' }
  return {
    records: (page.records || []).map((r) => ({
      ...normalizeReport(r),
      targetTypeText: typeText[r.targetType] || '未知',
      statusText: statusText[r.status] ?? '未知'
    })),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
export async function handleReport(id, { status, handleNote }) {
  const res = await request.post(`/admin/reports/${id}/handle`, { status, handleNote })
  return res.data
}

// ---- 后台用户管理（仅 ADMIN） ----
// GET /admin/users?keyword=&current=&size= 分页搜索用户
export async function listAdminUsers({ keyword = '', gameId = null, current = 1, size = 20 } = {}) {
  const res = await request.get('/admin/users', {
    params: {
      keyword: keyword || undefined,
      gameId: gameId == null ? undefined : gameId,
      current,
      size
    }
  })
  const page = res.data || {}
  const statusText = { 0: '正常', 1: '禁用' }
  return {
    records: (page.records || []).map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      status: u.status,
      statusText: statusText[u.status] ?? '未知',
      roles: u.roles || [],
      createdAt: (u.createdAt || '').replace('T', ' ').slice(0, 16),
      // 9-07：版主授权列表（含 gameName），前端卡片展示「负责游戏：xxx」
      moderatorAssignments: u.moderatorAssignments || []
    })),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}

// GET /admin/users/{id} 用户详情（含角色与版主负责板块）
export async function getUserAdminDetail(id) {
  const res = await request.get(`/admin/users/${id}`)
  const d = res.data || {}
  return {
    id: d.id,
    username: d.username,
    nickname: d.nickname,
    avatar: d.avatar,
    status: d.status,
    email: d.email,
    bio: d.bio || '',
    roles: d.roles || [],
    moderatorBoardIds: d.moderatorBoardIds || []
  }
}

// PUT /admin/users/{id}/roles 全量替换角色（角色 code 列表）
export async function updateUserRoles(id, roles) {
  const res = await request.put(`/admin/users/${id}/roles`, { roles })
  return res.data
}

// GET /admin/users/{id}/moderator-boards 取某版主负责的 (游戏, 板块) 授权列表
// 返回 [{ gameId, boardId, gameName, boardName }]
export async function getModeratorBoards(id) {
  const res = await request.get(`/admin/users/${id}/moderator-boards`)
  return res.data || []
}

// PUT /admin/users/{id}/moderator-boards 全量设置版主负责 (游戏, 板块) 对
// body: { items: [{ gameId, boardId }] }
export async function setModeratorBoards(id, items) {
  const res = await request.put(`/admin/users/${id}/moderator-boards`, { items })
  return res.data
}

// ---- 帖子审核列表（ADMIN 全量 / MODERATOR 仅负责板块） ----
// GET /admin/posts?boardId=&status=&current=&size=  status: 0=可见 1=隐藏 2=待审核
export async function listModerationPosts({ boardId = null, status = null, order = 'desc', days = null, current = 1, size = 20 } = {}) {
  const res = await request.get('/admin/posts', {
    params: {
      boardId: boardId || undefined,
      status: status == null ? undefined : status,
      order,
      days: days == null ? undefined : days,
      current,
      size
    }
  })
  const page = res.data || {}
  return {
    records: (page.records || []).map(normalizePost),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}

// ---- 帖子审核发布（仅 ADMIN） ----
// POST /admin/posts/{id}/approve 通过发布（status=0）
export async function adminApprovePost(id) {
  const res = await request.post(`/admin/posts/${id}/approve`)
  return res.data // { status }
}
// POST /admin/posts/{id}/pending 设为待审核（status=2）
export async function adminSetPostPending(id) {
  const res = await request.post(`/admin/posts/${id}/pending`)
  return res.data // { status }
}
// GET /admin/posts/{id}/detail 管理员预览详情（绕过状态过滤）
export async function adminPostDetail(id) {
  const res = await request.get(`/admin/posts/${id}/detail`)
  return res.data || null
}
// POST /admin/posts/{id}/reject 驳回：body { reason } → status=1 隐藏 + 通知发帖人
export async function adminRejectPost(id, reason) {
  const res = await request.post(`/admin/posts/${id}/reject`, { reason })
  return res.data
}
// GET /admin/posts/{id}/can-review 当前用户能否审这个帖（按钮使能依据）
export async function adminCanReviewPost(id) {
  const res = await request.get(`/admin/posts/${id}/can-review`)
  return res.data || { canReview: false }
}
// GET /admin/posts/{id}/replies 管理端回帖列表（含隐藏，供回帖审核）
export async function adminPostReplies(id) {
  const res = await request.get(`/admin/posts/${id}/replies`)
  return (res.data || []).map((r) => ({
    id: r.id,
    postId: r.postId,
    floor: r.floor,
    content: r.content,
    authorName: r.authorName,
    authorAvatar: r.authorAvatar,
    replyToName: r.replyToName || '',
    likeCount: r.likeCount || 0,
    status: r.status, // 0=正常 1=隐藏
    createdAt: (r.createdAt || '').replace('T', ' ').slice(0, 16)
  }))
}

// ---- 回帖审核（ADMIN / MODERATOR） ----
// POST /admin/replies/{id}/hide 隐藏回帖
export async function adminHideReply(id) {
  const res = await request.post(`/admin/replies/${id}/hide`)
  return res.data // { status }
}
// POST /admin/replies/{id}/restore 恢复回帖
export async function adminRestoreReply(id) {
  const res = await request.post(`/admin/replies/${id}/restore`)
  return res.data // { status }
}

// ---- 用户深度管理（仅 ADMIN）：封禁/资料/改密/删除 ----
// PUT /admin/users/{id}/status?status=0|1 封禁(1)/解封(0)
export async function updateUserStatus(id, status) {
  const res = await request.put(`/admin/users/${id}/status`, null, { params: { status } })
  return res.data
}
// PUT /admin/users/{id}/profile 编辑资料 { nickname, bio, email, avatar, gender }
export async function updateUserProfile(id, profile) {
  const res = await request.put(`/admin/users/${id}/profile`, profile)
  return res.data
}
// PUT /admin/users/{id}/reset-password 重置密码，返回新密码（管理员指定或随机生成）
export async function resetUserPassword(id, newPassword = '') {
  const res = await request.put(`/admin/users/${id}/reset-password`, { newPassword })
  return res.data // { password }
}
// DELETE /admin/users/{id} 删除用户
export async function deleteUser(id) {
  const res = await request.delete(`/admin/users/${id}`)
  return res.data
}

// ---- 公告：公开 ----
// GET /announcements?size= 取展示中的最新公告
export async function getAnnouncements(size = 5) {
  const res = await request.get('/announcements', { params: { size } })
  return (res.data || []).map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    isTop: !!a.isTop, // 9-08 强化：必须保留 isTop，否则公告弹窗无法区分置顶/普通
    creatorName: a.creatorName || '官方',
    createdAt: (a.createdAt || '').replace('T', ' ').slice(0, 16)
  }))
}
// GET /announcements/{id} 详情
export async function getAnnouncement(id) {
  const res = await request.get(`/announcements/${id}`)
  const a = res.data || {}
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    isTop: !!a.isTop, // 同上
    creatorName: a.creatorName || '官方',
    createdAt: (a.createdAt || '').replace('T', ' ').slice(0, 16)
  }
}

// ---- 公告：后台管理（仅 ADMIN） ----
// GET /admin/announcements?current=&size= 分页列表（含隐藏）
export async function listAdminAnnouncements({ current = 1, size = 20 } = {}) {
  const res = await request.get('/admin/announcements', { params: { current, size } })
  const page = res.data || {}
  const statusText = { 0: '展示', 1: '隐藏' }
  return {
    records: (page.records || []).map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      status: a.status,
      statusText: statusText[a.status] ?? '未知',
      isTop: !!a.isTop,
      creatorName: a.creatorName || '',
      createdAt: (a.createdAt || '').replace('T', ' ').slice(0, 16)
    })),
    total: page.total || 0,
    pages: page.pages || 0,
    current: page.current || current,
    size: page.size || size
  }
}
// POST /admin/announcements 创建 { title, content, status } —— v1.2 起不再需要 sort
export async function createAnnouncement(data) {
  const payload = { title: data.title, content: data.content, status: data.status ?? 0 }
  const res = await request.post('/admin/announcements', payload)
  return res.data
}
// PUT /admin/announcements/{id} 更新
export async function updateAnnouncement(id, data) {
  const payload = { title: data.title, content: data.content, status: data.status ?? 0 }
  const res = await request.put(`/admin/announcements/${id}`, payload)
  return res.data
}
// PUT /admin/announcements/{id}/pin 置顶/取消置顶 { isTop: true|false }
export async function pinAnnouncement(id, isTop) {
  const res = await request.put(`/admin/announcements/${id}/pin`, { isTop: !!isTop })
  return res.data
}
// DELETE /admin/announcements/{id} 删除
export async function deleteAnnouncement(id) {
  const res = await request.delete(`/admin/announcements/${id}`)
  return res.data
}

// ---- 后台：游戏管理（仅 ADMIN） ----
// POST /admin/games 创建 { name, cover, platform, genre, description, developer, publisher, releaseDate, sort, status }
export async function createGame(data) {
  const res = await request.post('/admin/games', data)
  return res.data // { id }
}
// PUT /admin/games/{id} 更新
export async function updateGame(id, data) {
  const res = await request.put(`/admin/games/${id}`, data)
  return res.data
}
// DELETE /admin/games/{id} 删除
export async function deleteGame(id) {
  const res = await request.delete(`/admin/games/${id}`)
  return res.data
}
// POST /admin/games/{id}/toggle-status 启用/禁用
export async function toggleGameStatus(id) {
  const res = await request.post(`/admin/games/${id}/toggle-status`)
  return res.data // { id }
}
// GET /admin/games 管理后台全量列表（含禁用），返回 Game 数组
export async function listAdminGames() {
  const res = await request.get('/admin/games')
  return (res.data || []).map(normalizeGame)
}

// v1.2 起：精选管理功能已下线（setDailyPick / removeDailyPick / listAdminPicks 已删除）。
// 每日精选改为系统按综合评分自动选；人工加精走 post.is_essence（已有「加精」能力）。
