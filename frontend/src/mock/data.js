// ============================================================================
// Mock 数据层（原型期）
// 后期接入后端后，仅需把 src/api/community.js 中的实现替换为真实请求即可，
// 组件层无需改动。
// ============================================================================

// ---- 板块（含帖子数 / 热度标识） ----
export const boards = [
  // 父级：攻略心得
  { id: 'b-guide', name: '攻略心得', emoji: '📘', parentId: null, desc: '通关思路、配装、流程，硬核玩家的主战场', postCount: 362 },
  { id: 'b-pc', name: 'PC 游戏', emoji: '💻', parentId: 'b-guide', desc: 'PC 端大作的攻略与讨论', postCount: 128 },
  { id: 'b-mobile', name: '手机游戏', emoji: '📱', parentId: 'b-guide', desc: '手游攻略、抽卡与长草期', postCount: 86 },
  { id: 'b-console', name: '主机游戏', emoji: '🎮', parentId: 'b-guide', desc: 'PS / Xbox / Switch 主机游戏', postCount: 73 },
  // 一级板块
  { id: 'b-roast', name: '游戏吐槽', emoji: '💬', parentId: null, desc: '来这儿把不爽都说出来', postCount: 54 },
  { id: 'b-teach', name: '教学讨论', emoji: '🎓', parentId: null, desc: '机制解析、新手答疑', postCount: 41 },
  { id: 'b-news', name: '资讯速递', emoji: '📰', parentId: null, desc: '版本更新、赛事、圈内大事', postCount: 29 },
  { id: 'b-fan', name: '二次创作', emoji: '🎨', parentId: null, desc: '同人图、MAD、整活二创', postCount: 18 }
]

// ---- 帖子 ----
export const posts = [
  {
    id: 'p1',
    title: '【艾尔登法环】DLC 最终 BOSS 无伤通关思路 + 配装分享',
    author: '褪色者老王',
    avatar: '🛡️',
    boardId: 'b-console',
    boardName: '主机游戏',
    boardTag: '主机·魂系',
    isTop: true,
    isEssence: true,
    isHot: true,
    excerpt:
      '花了 60 小时终于把最终 BOSS 摸透了，核心思路是贴脸绕后 + 反手重击，配装走感应流，出血叠加非常舒服。下面分三个阶段讲……',
    coverEmoji: '🎮',
    replyCount: 328,
    likeCount: 1240,
    viewCount: 28900,
    createdAt: '2026-08-15 22:10'
  },
  {
    id: 'p2',
    title: '【CS2】炼狱小镇进攻方默认烟闪教学，白银也能打爆对面',
    author: 'AK 压枪怪',
    avatar: '🔫',
    boardId: 'b-pc',
    boardName: 'PC 游戏',
    boardTag: '射击·PC',
    isTop: false,
    isEssence: false,
    isHot: true,
    excerpt:
      '很多人进攻小镇只会干拉，其实 A 点两颗烟一颗闪就能稳下包。附上我常用的 5 套默认战术与投掷点位演示……',
    coverEmoji: '💥',
    replyCount: 156,
    likeCount: 642,
    viewCount: 15300,
    createdAt: '2026-08-16 09:32'
  },
  {
    id: 'p3',
    title: '【原神】4.7 版本枫丹水下解谜全收集线路图',
    author: '提瓦特导游',
    avatar: '🌊',
    boardId: 'b-mobile',
    boardName: '手机游戏',
    boardTag: '手机·开放世界',
    isTop: false,
    isEssence: true,
    isHot: false,
    excerpt:
      '4.7 水下谜题又藏了一堆宝箱，我把 32 个解密点按最优路线串成一张图，照着走 40 分钟全清，含两个隐藏成就触发条件……',
    coverEmoji: '🗺️',
    replyCount: 92,
    likeCount: 510,
    viewCount: 9800,
    createdAt: '2026-08-14 18:45'
  },
  {
    id: 'p4',
    title: '【黑神话悟空】第三章 BOSS 顺序与最低配置流畅运行设置',
    author: '天命人小六',
    avatar: '🐒',
    boardId: 'b-pc',
    boardName: 'PC 游戏',
    boardTag: 'PC·动作',
    isTop: false,
    isEssence: false,
    isHot: false,
    excerpt:
      '第三章小西天 boss 又多又硬，给个稳妥的击杀顺序省时间。配置方面，1060 笔记本也能 45 帧，关键是关掉体积云 + 调阴影质量……',
    coverEmoji: '🐲',
    replyCount: 211,
    likeCount: 880,
    viewCount: 21000,
    createdAt: '2026-08-13 21:03'
  },
  {
    id: 'p5',
    title: '【手游盘点】那些年我们追过的二次元，哪款你还在坚持？',
    author: '抽卡非酋',
    avatar: '🎲',
    boardId: 'b-mobile',
    boardName: '手机游戏',
    boardTag: '手机游戏',
    isTop: false,
    isEssence: false,
    isHot: false,
    excerpt:
      '从开服玩到现在的也就两三款了，曾经爆火的不少已经停服。聊聊你入坑最久的一款，以及为什么还在玩 / 已经弃了……',
    coverEmoji: '📱',
    replyCount: 47,
    likeCount: 233,
    viewCount: 6200,
    createdAt: '2026-08-12 12:20'
  },
  {
    id: 'p6',
    title: '【讨论】开放世界是不是已经到了瓶颈期？谈谈我的看法',
    author: '云玩家阿宅',
    avatar: '☁️',
    boardId: 'b-teach',
    boardName: '教学讨论',
    boardTag: '开放世界',
    isTop: false,
    isEssence: false,
    isHot: true,
    excerpt:
      '地图越来越大、内容越来越稀释，真正好玩的支线反而变少。是不是厂商把"开放世界"当成了偷懒的借口？欢迎来辩……',
    coverEmoji: '🌐',
    replyCount: 274,
    likeCount: 998,
    viewCount: 18700,
    createdAt: '2026-08-11 20:15'
  }
]

// ---- 帖子详情回帖（含楼中楼） ----
export const replies = {
  p1: [
    {
      id: 'r1',
      author: '萌新求带',
      avatar: '🐣',
      content: '老哥牛的，请问感应流具体点哪几个属性？我刚入坑不太懂配装。',
      likeCount: 36,
      createdAt: '2026-08-15 22:40',
      children: [
        {
          id: 'r1-1',
          author: '褪色者老王',
          avatar: '🛡️',
          content: '感应点到 60 左右，剩下的给耐力和血，护符带出血相关那几个。',
          likeCount: 12,
          createdAt: '2026-08-15 22:55'
        }
      ]
    },
    {
      id: 'r2',
      author: '手柄战神',
      avatar: '🎮',
      content: '无伤是真的强，不过我用手柄绕后总被反打，手法还得练。',
      likeCount: 21,
      createdAt: '202o-08-15 23:10'.replace('o', '6'),
      children: []
    }
  ]
}

// ---- 右栏：热门榜 ----
export const hotList = [
  { id: 'p1', title: '【艾尔登法环】DLC 最终 BOSS 无伤通关思路', heat: 28900 },
  { id: 'p4', title: '【黑神话悟空】第三章 BOSS 顺序与配置设置', heat: 21000 },
  { id: 'p6', title: '【讨论】开放世界是不是已经到了瓶颈期', heat: 18700 },
  { id: 'p2', title: '【CS2】炼狱小镇进攻方默认烟闪教学', heat: 15300 },
  { id: 'p3', title: '【原神】4.7 枫丹水下解谜全收集线路', heat: 9800 }
]

// ---- 右栏：活跃玩家 ----
export const activeUsers = [
  { name: '褪色者老王', avatar: '🛡️', badge: 'Lv.42 魂学导师' },
  { name: 'AK 压枪怪', avatar: '🔫', badge: 'Lv.38 战术大师' },
  { name: '提瓦特导游', avatar: '🌊', badge: 'Lv.35 探索达人' },
  { name: '天命人小六', avatar: '🐒', badge: 'Lv.31 天命人' }
]

// ---- 右栏：公告 ----
export const announcements = [
  '《社区公约 2.0》上线，请文明发言，理性讨论',
  '8 月新番 & 新游速递专栏已开，欢迎投稿',
  '官方活动：晒出你的年度游戏，抽限定周边'
]
