#!/usr/bin/env node
/**
 * ============================================================================
 *  YUMU 社区「演示数据重整」脚本
 * ============================================================================
 *  作用：一次性把库里自动化测试留下的脏数据清掉，再灌入一批"正常玩家会发"的
 *       真实风格内容（帖子 / 回帖 / 楼中楼 / 点赞 / 收藏 / 关注 / 通知 /
 *       签到 / 积分），最后重算全部计数列，保证数据自洽。
 *
 *  用法：
 *    node tests/seed-demo-community.mjs                 # 只生成 SQL 到 db-backup/
 *    node tests/seed-demo-community.mjs --apply         # 生成并执行（走 mysql CLI）
 *    node tests/seed-demo-community.mjs --posts 300     # 改帖子总量（默认 500）
 *    node tests/seed-demo-community.mjs --keep-demo     # 保留既有演示帖（不清帖子）
 *
 *  环境变量：DB_HOST(127.0.0.1) DB_PORT(3306) DB_USER(root) DB_PASSWORD(123456)
 *            DB_NAME(yumu_community)
 *
 *  ⚠️ 执行前请务必先备份：mysqldump ... > db-backup/xxx.sql
 *  ⚠️ 脚本会清空 post/reply/likes/... 全表，UI 上后加的帖子也会被清掉。
 *
 *  设计要点（踩过的坑，勿轻易改）：
 *   1. 显式指定主键 id（用户 1001+ / 帖子 5001+ / 回帖 6001+），否则无法生成
 *      reply.reply_to_id、post_tag、likes.target_id 这些交叉引用。
 *   2. 计数列（board.post_count / game.post_count / post.reply_count /
 *      post.like_count / tag.use_count）必须与真实行数一致 —— 前端首页、板块页、
 *      游戏专区、帖子详情都直接读这些列，不重算就是"数据对不上"。
 *   3. 唯一键约束（生成前已在 JS 里去重）：
 *        likes(user_id,target_type,target_id) / favorite(user_id,post_id)
 *        follow(user_id,follow_type,follow_id) / post_tag(post_id,tag_id)
 *        sign_in(user_id,sign_date) / notification(user_id,type,target_id,source_id)
 *        moderator_board(user_id,game_id,board_id)
 *   4. post.status 语义：0=正常（公开可见） 1=隐藏/驳回 2=待审核。
 *      公开列表只显示 status=0，所以绝大多数数据必须是 0。
 *   5. 随机数走固定种子（SEED），同一份脚本每次生成结果一致，便于复现与对比。
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ---------------------------------------------------------------- 参数解析
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const KEEP_DEMO = argv.includes('--keep-demo')
const argPosts = argv.indexOf('--posts')
const POST_TOTAL = argPosts >= 0 ? Number(argv[argPosts + 1]) || 500 : 500

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || '3306',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  name: process.env.DB_NAME || 'yumu_community'
}

// ---------------------------------------------------------------- 随机数（可复现）
let _seed = 20260910
function rnd () {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))       // 闭区间整数
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
function pickN (arr, n) {
  const c = [...arr]; const out = []
  for (let i = 0; i < n && c.length; i++) out.push(...c.splice(Math.floor(rnd() * c.length), 1))
  return out
}

// ---------------------------------------------------------------- SQL 工具
// raw('SQL 片段') 用于把子查询/表达式原样塞进 VALUES，不走字符串转义
const raw = (s) => ({ __raw: s })
const esc = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object' && v.__raw !== undefined) return v.__raw
  if (typeof v === 'number') return String(v)
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"
}
const chunks = []
function sql (s) { chunks.push(s.replace(/;+\s*$/, '')) }
function insertMany (table, cols, rows, perStmt = 250) {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += perStmt) {
    const part = rows.slice(i, i + perStmt)
      .map(r => '(' + r.map(esc).join(',') + ')').join(',')
    sql(`INSERT INTO \`${table}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES ${part}`)
  }
}

// 日期工具（全部按本地时区生成 'YYYY-MM-DD HH:mm:ss'）
const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const fmtD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 站点时间窗：与现有数据一致（8-15 建站 → 现在）
const NOW = new Date('2026-09-10T21:40:00')
const SITE_START = new Date('2026-08-15T09:00:00')

// ============================================================================
//  一、游戏词库（每个游戏的真实黑话/角色/机制，用来让帖子"像人写的"）
// ============================================================================
const GAMES = [
  {
    id: 2, name: '原神', w: 1.45, ver: '5.0', platform: '多平台',
    heroes: ['芙宁娜', '那维莱特', '钟离', '胡桃', '雷电将军', '纳西妲', '夜兰', '万叶'],
    terms: ['圣遗物', '元素精通', '暴击率', '双爆词条', '树脂', '原石', '大保底', '命座'],
    modes: ['深渊12层', '大世界', '周本', '活动副本', '鹤观', '纳塔'],
    issues: ['保底越抽越歪', '圣遗物刷一个月没出货', '体力永远不够用']
  },
  {
    id: 3, name: '王者荣耀', w: 1.30, ver: 'S36', platform: '手机',
    heroes: ['后羿', '鲁班七号', '貂蝉', '镜', '澜', '大司命', '桑启'],
    terms: ['铭文', '打野', '辅助', '连招', '出装', '闪现', '净化', '反打'],
    modes: ['排位', '巅峰赛', '匹配', '大乱斗'],
    issues: ['队友永远在挂机', '版本之子太离谱', '一局二十分钟起步']
  },
  {
    id: 10, name: '崩坏：星穹铁道', w: 1.25, ver: '2.4', platform: '多平台',
    heroes: ['流萤', '黄泉', '花火', '托帕', '银狼', '砂金'],
    terms: ['星琼', '遗器', '光锥', '大月卡', '量子', '虚数', '追加攻击'],
    modes: ['忘却之庭', '模拟宇宙', '混沌回忆', '活动关卡'],
    issues: ['遗器副词条纯看脸', '体力换遗器血亏', '角色歪得像抽盲盒']
  },
  {
    id: 19, name: '三角洲行动', w: 1.15, ver: 'S4', platform: '多平台',
    heroes: ['红狼', '威龙', '乌兹', '阿列克谢'],
    terms: ['撤离', '摸金', '战备值', '红卡', '机密', '弹药', '护甲'],
    modes: ['烽火地带', '全面战场', '港口', '零号大坝'],
    issues: ['撤离点被堵', '装备一局全丢', '队友永远抢箱子']
  },
  {
    id: 17, name: '黑神话：悟空', w: 1.10, ver: '1.0', platform: '主机',
    heroes: ['天命人', '八戒', '二郎神', '牛魔王'],
    terms: ['棍势', '识破', '变身', '法术', '影神图', '葫芦', '泡酒物'],
    modes: ['一周目', '二周目', '隐藏boss', '白金'],
    issues: ['幽魂卡了三天', '寅虎太难', '地图容易迷路']
  },
  {
    id: 5, name: '英雄联盟', w: 1.10, ver: '14.17', platform: 'PC',
    heroes: ['亚索', '剑姬', '卡特', '伊泽瑞尔', '劫', '永恩'],
    terms: ['补刀', '走A', '大龙', '视野', '天赋', '装备', '换线'],
    modes: ['排位', '极地大乱斗', '云顶之弈', '匹配'],
    issues: ['打野永远不抓上路', '被反野反过来怪我', '五连跪之后只想卸载']
  },
  {
    id: 6, name: 'CS2', w: 1.00, ver: '2026秋', platform: 'PC',
    heroes: ['AWP', 'AK-47', 'M4A1', '沙鹰'],
    terms: ['道具', '烟雾弹', '闪光', '燃烧瓶', 'eco局', '经济', '压枪', '爆头线'],
    modes: ['官匹', '完美平台', '5E', '竞技模式'],
    issues: ['队友沉默一整局', '烟雾弹改得像开了挂', '挂哥永远在对面']
  },
  {
    id: 7, name: '永劫无间', w: 0.95, ver: 'S14', platform: 'PC',
    heroes: ['天海', '宁红夜', '季沧海', '特木尔'],
    terms: ['振刀', '魂玉', '护符', '拼刀', '拉刀', '掠影步'],
    modes: ['三排', '单排', '吃鸡模式'],
    issues: ['网络一卡就白给', '振刀窗口摸不准', '决赛圈全是高手']
  },
  {
    id: 11, name: '绝区零', w: 0.95, ver: '1.3', platform: '多平台',
    heroes: ['简', '艾莲', '珂蕾妲', '朱鸢'],
    terms: ['代理人', '邦布', '音擎', '驱动盘', '以太', '连携'],
    modes: ['零号空洞', '临界推演', '日常委托'],
    issues: ['驱动盘词条太随机', '体力不够用', '音擎池太劝退']
  },
  {
    id: 12, name: '明日方舟', w: 0.90, ver: '2026夏活', platform: '手机',
    heroes: ['银灰', '艾雅法拉', '澄闪', '斥罪', '缄默德克萨斯'],
    terms: ['干员', '技能专精', '材料', '龙门币', '部署费用', '天赋'],
    modes: ['剿灭作战', '集成战略', '危机合约', '高难关卡'],
    issues: ['材料永远不够', '危机合约太难顶', '六星越出越超模']
  },
  {
    id: 4, name: '和平精英', w: 0.90, ver: 'S28', platform: '手机',
    heroes: ['吉利服', 'M416', 'AWM'],
    terms: ['跳伞点', '压枪', '灵敏度', '腰射', '配件', '倍镜', '载具'],
    modes: ['经典模式', '团队竞技', '生化模式', '地铁逃生'],
    issues: ['队友开局就送', '决赛圈永远在圈外', '外挂封不完']
  },
  {
    id: 9, name: '第五人格', w: 0.85, ver: 'S30', platform: '手机',
    heroes: ['小丑', '红夫人', '梦之女巫', '机械师', '佣兵'],
    terms: ['破译', '板窗区', '天赋', '闪现', '传送', '牵制'],
    modes: ['排位', '双监管', '混沌纷争'],
    issues: ['监管太超模', '队友不救人', '排位匹配莫名其妙']
  },
  {
    id: 15, name: 'APEX英雄', w: 0.85, ver: 'S24', platform: 'PC',
    heroes: ['恶灵', '命脉', '动力小子', '寻血猎犬'],
    terms: ['传奇', '跳伞点', '枪械', '配件', '护甲', '位移'],
    modes: ['排位', '三人组队', '碎片东部', '世界尽头'],
    issues: ['跳伞就被团灭', '队友秒退', '枪法练不出来']
  },
  {
    id: 16, name: '艾尔登法环', w: 0.80, ver: '1.14', platform: '主机',
    heroes: ['褪色者', '女武神', '蒙格', '拉塔恩'],
    terms: ['战灰', '骨灰', '赐福', '祷告', '魔法', '盾反', '强化'],
    modes: ['一周目', '深根底层', 'DLC黄金树幽影', '无伤挑战'],
    issues: ['Boss连招太快', '容易迷路', '被小怪阴死']
  },
  {
    id: 8, name: '蛋仔派对', w: 0.80, ver: 'S12', platform: '手机',
    heroes: ['蛋小黄', '蛋小黑'],
    terms: ['乐园', '皮肤', '道具', '关卡', '打卡', '工坊'],
    modes: ['休闲模式', '竞速模式', '组队闯关', '乐园地图'],
    issues: ['皮肤越来越贵', '匹配到挂机队友', '关卡太难跳']
  },
  {
    id: 18, name: '塞尔达传说：王国之泪', w: 0.75, ver: '1.2', platform: '主机',
    heroes: ['林克', '塞尔达'],
    terms: ['究极手', '左纳乌装置', '神庙', '大师剑', '武器耐久', '滑翔伞'],
    modes: ['主线', '地下世界', '空岛', '全神庙'],
    issues: ['武器耐久太折磨', '左纳乌装置拼不明白', '地图大到迷路']
  },
  {
    id: 13, name: '阴阳师', w: 0.75, ver: '2026', platform: '手机',
    heroes: ['伊邪那美', '须佐之男', 'sp山兔', '食灵'],
    terms: ['御魂', '式神', '招财猫', '暴击御魂', '觉醒', '魂十'],
    modes: ['秘闻副本', '斗技', '结界突破', '御魂副本'],
    issues: ['御魂副词条纯看脸', '斗技节奏太慢', '抽卡越来越歪']
  },
  {
    id: 14, name: 'DOTA2', w: 0.75, ver: '7.37', platform: 'PC',
    heroes: ['宙斯', '影魔', '敌法师', '黑鸟', '马格纳斯'],
    terms: ['中单', '天梯', '出装', '分路', '团战', '拆塔', '视野'],
    modes: ['天梯', '加速模式', '普通匹配'],
    issues: ['中单崩了整局没法打', '队友永远不看小地图', '天梯分上不去']
  },
  {
    id: 1, name: '其他游戏', w: 0.55, ver: '近期', platform: '多平台',
    heroes: ['主角'],
    terms: ['手感', '剧情', '画质', '玩法', '优化'],
    modes: ['主线', '多人模式'],
    issues: ['优化一塌糊涂', '内容更新太慢']
  }
]
const GAME_BY_ID = Object.fromEntries(GAMES.map(g => [g.id, g]))

// ============================================================================
//  二、板块与内容模板
// ============================================================================
const BOARD = { GUIDE: 1, RANT: 2, TEAM: 3, NEWS: 4, ART: 5, MISC: 6 }

const BOARD_META = {
  1: { name: '攻略心得', type: 1, tags: ['攻略', '技巧', '入门', '思路', '配装', '萌新'] },
  2: { name: '游戏吐槽', type: 0, tags: ['吐槽', '吐槽大会', 'bug', '策划', '心态'] },
  3: { name: '组队大厅', type: 0, tags: ['组队', '开黑', '车队', '招募', '萌新'] },
  4: { name: '资讯速递', type: 2, tags: ['资讯', '更新', '活动', '赛事', '前瞻'] },
  5: { name: '二次创作', type: 0, tags: ['同人', '绘画', '剪辑', 'cos', '表情包'] },
  6: { name: '其他', type: 0, tags: ['闲聊', '杂谈', '日常', '入坑'] }
}
// 板块权重（真实社区里攻略/吐槽占大头，二创最少）
const BOARD_WEIGHT = { 1: 0.30, 2: 0.19, 3: 0.12, 4: 0.15, 5: 0.10, 6: 0.14 }

// 游戏类型标签（按游戏附加）
const GENRE_TAG = {
  2: ['二次元', '开放世界'], 3: ['电竞'], 10: ['二次元'], 19: ['电竞'],
  17: ['魂系', '单机大作'], 5: ['电竞'], 6: ['电竞'], 7: ['电竞'], 11: ['二次元'],
  12: ['二次元'], 4: ['电竞'], 9: ['二次元', '恐怖生存'], 15: ['电竞'],
  16: ['魂系', '单机大作', '开放世界'], 8: ['多人联机'], 18: ['开放世界', '单机大作'],
  13: ['二次元'], 14: ['电竞'], 1: ['独立游戏']
}

// ---- 标题与正文模板：全部是"看起来像真人发的"口吻 ----
function titleFor (board, g) {
  const h = () => pick(g.heroes), t = () => pick(g.terms), m = () => pick(g.modes)
  switch (board) {
    case 1: return pick([
      `【${g.name}】${h()}配${t()}实测，伤害直接翻了个倍`,
      `${g.name}${m()}通关思路：卡好${t()}才是关键，别再硬刚了`,
      `${g.name}萌新必看：${t()}优先级排序，资源别乱花`,
      `实测${g.name}${h()}的${t()}打法，第3个细节90%的人不知道`,
      `${g.name}${g.ver}版本${h()}强度分析，${t()}到底怎么堆`,
      `${g.name}${m()}速通思路分享，附${t()}细节和走位`,
      `${g.name}资源规划避坑指南，${t()}千万别乱用`,
      `打了${ri(3, 30)}天${g.name}才明白：${t()}比堆数值重要`,
      `${g.name}${h()}冷门但极强的${t()}搭配，练度不够也能打`,
      `${g.name}${m()}稳定过关打法，容错率很高适合手残`
    ])
    case 2: return pick([
      `说真的，${g.name}这波${t()}改动我是真没看懂`,
      `${g.name}里最离谱的${t()}，我直接笑出声`,
      `为什么${g.name}的${m()}总让我心态爆炸`,
      `玩了${ri(200, 3000)}小时${g.name}，${t()}这块真的劝退`,
      `${g.name}的${h()}是不是有点太离谱了？`,
      `${g.name}${g.ver}更新之后，${t()}手感稀烂`,
      `吐槽一下${g.name}的${m()}，${pick(g.issues)}`,
      `不吹不黑，${g.name}现在最大的问题就是${pick(g.issues)}`,
      `${g.name}玩家现状：${pick(g.issues)}`,
      `${g.name}这${t()}是不是该改改了？求求策划看一眼`
    ])
    case 3: return pick([
      `【${g.name}开黑】今晚8点缺${ri(1, 3)}个队友，会玩就行，带麦来`,
      `${g.name}萌新找固定队，${m()}都能打，在线等挺急的`,
      `周末${g.name}冲分车队，差一个${h()}，要求稳定不坑`,
      `${g.name}休闲娱乐局，不肝不卷，来几个聊得来的`,
      `${g.name}${m()}搭子长期收人，稳定${ri(3, 5)}人小队`,
      `${g.name}车队招人，${t()}玩得明白就行，晚上在线`,
      `找${g.name}队友，被野队坑怕了，想找几个正常的`,
      `${g.name}跨平台组队！手机PC都能打，缺${ri(2, 3)}人`,
      `${g.name}固定队第${ri(2, 9)}期招新，主要打${m()}`,
      `有没有${g.name}的老哥愿意带带萌新的，我${t()}还不太懂`
    ])
    case 4: return pick([
      `${g.name}官方前瞻公布，${g.ver}版本${h()}要来了`,
      `速报：${g.name}开启限时活动，奖励直接拉满`,
      `${g.name}赛事总决赛落幕，这波${h()}操作直接封神`,
      `${g.name}${g.ver}版本更新公告：${t()}平衡性大改`,
      `${g.name}联动确认！这次的跨界是真没想到`,
      `${g.name}官方回应${t()}争议，补偿方案已公布`,
      `${g.name}新${h()}实装，玩家评价两极分化`,
      `${g.name}赛季奖励调整，${t()}改动提前看`,
      `${g.name}下周维护公告：这批${t()}改动影响挺大`,
      `${g.name}玩家期待已久的${t()}优化终于上线了`
    ])
    case 5: return pick([
      `肝了张${g.name}${h()}同人图，第一次画求轻喷`,
      `剪了个${g.name}高燃混剪，BGM一上头就燃了`,
      `${g.name}${h()}cos完成，妆造花了${ri(2, 6)}小时`,
      `用${g.name}梗做了个表情包，笑不活了`,
      `${g.name}同人短篇：${h()}的一天`,
      `画了${ri(2, 5)}张${g.name}头像，随便抱走`,
      `${g.name}${m()}名场面重绘，画到凌晨三点`,
      `给${g.name}的${h()}做了套像素皮肤，看看行不行`,
      `${g.name}原创表情包第${ri(2, 8)}弹，日常互怼用`,
      `${g.name}手书进度分享，分镜改了${ri(2, 6)}版`
    ])
    default: return pick([
      `今天突然又对${g.name}上头了，聊聊我的入坑经历`,
      `${g.name}和隔壁比，你们更肝哪个？来唠唠`,
      `深夜杂谈：我的${g.name}年度名场面`,
      `入坑${g.name}${ri(3, 60)}天，从萌新到退游边缘的心路历程`,
      `${g.name}玩了${ri(50, 1500)}小时，说点真心话`,
      `${g.name}居然出圈了，朋友圈都在刷，离谱`,
      `你们的${g.name}第一次是怎么入坑的？`,
      `突然发现${g.name}已经陪我走过${ri(3, 24)}个月了`,
      `关于${g.name}，最近想明白了一件事`,
      `${g.name}玩了这么久，最舍不得的还是${h()}`
    ])
  }
}

function bodyFor (board, g) {
  const h = () => pick(g.heroes), t = () => pick(g.terms), m = () => pick(g.modes)
  const lead = `最近一直在玩${g.name}，${m()}这块算是摸得比较透了，说说我自己的感受。`
  const open = pick([
    lead,
    `先说结论：${g.name}这游戏${t()}没搞明白之前，练度都是虚的。`,
    `刷${g.name}也有段时间了，今天把踩过的坑整理一下。`,
    `不知道有没有人和我一个感觉，${g.name}最近${t()}这块变味了。`,
    `纯粹个人体验，不一定对，大家当个参考。`
  ])
  const mid = pick([
    `核心就两点：一是${t()}别乱用，二是${h()}的窗口期要卡准，早一步晚一步结果差很多。`,
    `我一般先把${t()}堆到够用，剩下的全给${h()}，这样${m()}打起来比较稳。`,
    `实测下来${h()}配${t()}的容错最高，容错率能高一大截，手残也能打。`,
    `${t()}这块我建议不要贪，先把基础循环跑顺，再考虑往上加。`,
    `关键是别着急，${m()}前两波先摸清机制，后面就顺了。`,
    `对比了一圈，最后还是觉得${h()}最省心，而且不吃太多资源。`
  ])
  const tail = pick([
    `有不同思路的欢迎在评论区补充，一起把帖子养肥。`,
    `如果有更省资源的打法，也欢迎交流一下。`,
    `${m()}这周还没打的可以照着试试，有问题评论区问我。`,
    `就想到这些，后面有别的心得再补。`,
    `纯个人经验，不喜勿喷，也欢迎指正。`,
    `最后祝大家都能顺利通关，少走弯路。`
  ])
  const extra = chance(0.45)
    ? '\n\n' + pick([
      `顺便说一句，${pick(g.issues)}这个问题是真的存在，希望官方能看到。`,
      `另外提醒一下，${t()}这块下个版本可能会调整，别投入太多。`,
      `还有个小细节：${m()}第二阶段的判定和提示不太一样，注意一下。`
    ])
    : ''
  return { open, mid, tail, extra }
}

// ---- 回帖模板 ----
const REPLY_POOL = [
  '这个思路可以，我今晚就试试',
  '楼主说得对，{t}确实是关键，之前一直没注意',
  '学到了，感谢分享',
  '按这个方法打了一把，确实稳多了',
  '我练度不太够，{m}还是过不去…',
  '同感，{t}这块太劝退了',
  '有没有{h}的替代方案？我这个池子没有',
  '收藏了，周末就去凹',
  '有一说一，这波确实可以',
  '楼主整理得挺细的，辛苦',
  '我打了两天都没过，看了这个帖终于懂了',
  '关键是{op}这个点，很多人做不到',
  '补充一个：{t}其实可以省下来后期用',
  '实测有效，给楼主点赞',
  '这个打法容错是高，就是节奏慢一点',
  '我用的另一套，也很稳，回头写个帖子',
  '楼主是哪个区的，方便的话带带我',
  '{t}我堆了半个月还是不行，纯看脸',
  '看完直接去试，回来汇报战果',
  '说得好，但我觉得{op}因人而异',
  '这个配装思路有意思，抄了',
  '谢谢楼主，对萌新真的很友好',
  '我之前就是卡在这，原来是要先破{t}',
  '感觉还是得看熟练度，理论归理论',
  '我按这个改了之后胜率高了不少',
  '有一说一，{t}这块确实容易上头',
  '楼主能不能出个下篇，讲下{m}细节',
  '这波分析挺到位的，不吹不黑',
  '我朋友也这么说，看来是共识了',
  '先码住，晚上回去研究一下'
]
const REPLY_TEAM = [
  '扣1，我时间比较自由',
  '带我一个，晚上基本都在线',
  '我{op}玩得还行，可以补位',
  '私信你了老哥',
  '可以拉个群吗，长期一起打',
  '我菜一点，会听指挥可以吗',
  '算我一个，正好缺固定队',
  '有麦，能打，来了',
  '还缺人吗？我这边有两个',
  '已加好友，ID同昵称'
]
const REPLY_NEWS = [
  '终于等到了，盼了好几个版本',
  '这改动看着不错，希望能实装',
  '补偿有点少啊，不过总比没有强',
  '前瞻截图看过了，美术是真的顶',
  '希望别又是画饼',
  '{t}改了之后平衡性应该会好点',
  '这波联动我没想到，挺惊喜的',
  '坐等更新，先把资源囤起来',
  '这赛季奖励确实该调了',
  '官方终于听劝了'
]
const REPLY_ART = [
  '画得好啊，线条很干净',
  '这张氛围感拉满了',
  '求原图，想拿来做壁纸',
  'BGM选得好，剪得也顺',
  '已经三连了，继续更',
  '这个配色好舒服',
  '表情包我收下了，谢谢',
  '手书质量很高啊，期待后续',
  '能不能出个{h}版本的',
  '妆造很还原，细节到位'
]
const REPLY_MISC = [
  '我也是这么入坑的，笑死',
  '看完有点想回去玩了',
  '同感，这游戏陪着长大的',
  '写得挺真诚的，点了',
  '我最舍不得的也是{h}',
  '其实退游过好几次，又回来了',
  '这游戏确实有魔力',
  '回忆杀，我第一反应也是这样',
  '说到心坎里了',
  '看哭了，兄弟'
]
// ⚠️ 楼中楼正文不要再写 "@昵称" 前缀：前端已有「回复 @昵称」标签，重复写会变成
//    "回复 @电竞少女: @电竞少女 我觉得…"，一眼就是机器生成的。见 verify-reseed 截图。
const REPLY_SUB = [
  '我觉得换{h}会更稳一点，你可以试试',
  '你这个情况多半是{t}没堆够',
  '同意，我昨天也是这么打的',
  '不一定吧，看{m}的形态变化',
  '求详细说说，我也卡这',
  '哈哈哈这个形容太贴切了',
  '我这边反过来，反而更顺手',
  '兄弟你哪个区的，交流一下',
  '感谢，回头我试一下',
  '确实，{op}这点很关键',
  '我就是被{m}劝退的，太难了',
  '同感，不过我还是想试试',
  '这个思路我倒是没想过',
  '楼主说得在理，学到了'
]
function replyText (board) {
  const pool = board === 3
    ? [...REPLY_TEAM, ...REPLY_POOL]
    : board === 4 ? [...REPLY_NEWS, ...REPLY_POOL]
      : board === 5 ? [...REPLY_ART, ...REPLY_POOL]
        : board === 6 ? [...REPLY_MISC, ...REPLY_POOL] : REPLY_POOL
  return pick(pool)
}
function fill (tpl, g, who = '', op = '') {
  return tpl
    .replace(/\{h\}/g, pick(g.heroes))
    .replace(/\{t\}/g, pick(g.terms))
    .replace(/\{m\}/g, pick(g.modes))
    .replace(/\{op\}/g, op || pick(['节奏', '走位', '资源分配', '心态', '手感']))
    .replace(/\{who\}/g, who)
}
/** 找出关注了 uid 的所有用户 id */
const followersOf = (uid, follows) => follows.filter(f => f.follow_id === uid).map(f => f.user_id)

// 新玩家统一初始口令 123456（bcrypt，由后端 jar --gen-password-hash 生成）
const PWD_HASH_123456 = '$2a$10$/6OGjuWWQj//VK87JbT0cO7lzyTiWQOu8y5RcEfmQR6.jUZP.DugS'

// ============================================================================
//  三、玩家池（真人风格昵称；用于分散作者，让社区像"很多人在发"）
// ============================================================================
const KEEP_USERS = [
  { id: 2, username: 'yumu', nickname: 'yumu', join: '2026-08-16', avatar: '/api/files/577fad7b50164071b5fcfe24ec29e6af.png' },
  { id: 10, username: 'ye_xingzhe', nickname: '夜行者', join: '2026-08-17' },
  { id: 11, username: 'caicaizi', nickname: '菜菜子', join: '2026-08-17' },
  { id: 12, username: 'laoxianyu', nickname: '老咸鱼', join: '2026-08-17' },
  { id: 13, username: 'dianjing', nickname: '电竞少女', join: '2026-08-17' },
  { id: 14, username: 'moyu', nickname: '摸鱼大师', join: '2026-08-18' },
  { id: 15, username: 'yinghe', nickname: '硬核玩家', join: '2026-08-18' },
  { id: 102, username: 'admin', nickname: '管理员', join: '2026-08-17', avatar: '/api/files/cdea8afd27ae4a3882e254944175ca10.png', admin: true },
  { id: 222, username: 'dada', nickname: 'cos管理员', join: '2026-08-18' },
  { id: 380, username: 'seed_tivat', nickname: '提瓦特老咸鱼', join: '2026-08-20' },
  { id: 381, username: 'seed_canyon', nickname: '峡谷一打九', join: '2026-08-20' },
  { id: 382, username: 'seed_chicken', nickname: '吃鸡苟分王', join: '2026-08-20' },
  { id: 383, username: 'seed_train', nickname: '星铁列车长', join: '2026-08-21' },
  { id: 384, username: 'seed_doctor', nickname: '方舟刀客塔', join: '2026-08-21' },
  { id: 385, username: 'seed_souls', nickname: '法环受苦人', join: '2026-08-21' },
  { id: 386, username: 'seed_hyrule', nickname: '海拉鲁旅人', join: '2026-08-22' },
  { id: 387, username: 'seed_delta', nickname: '三角洲干员', join: '2026-08-22' },
  { id: 388, username: 'seed_apex', nickname: 'APEX猎杀者', join: '2026-08-22' },
  { id: 389, username: 'seed_ink', nickname: '二次元画手', join: '2026-08-23' },
  { id: 405, username: 'demo_review', nickname: '审核演示号', join: '2026-08-24' },
  { id: 624, username: 'cwj', nickname: '陈炜杰', join: '2026-09-08' },
  { id: 671, username: 'saierda', nickname: 'saierda', join: '2026-08-25' }
]

const NEW_NAMES = [
  '一杯凉白开', '键盘上的猫', '半糖不加冰', '深夜打野鬼', '会飞的咸鱼干',
  '第七个存档', '麦麦脆汁鸡', '不打排位会死', '风来吴山', '小满今天上分了吗',
  '秃头小宝贝', '凌晨三点的灯', '路过的小透明', '五杀不过如此', '阿伟又输了',
  '摸鱼小分队队长', '老张头打游戏', '月半弯弯', '一颗糖两种味', '国服第一菜',
  '云里雾里看花', '快乐星球原住民', '只想安静抽卡', '打不过就摆烂', '峡谷常驻民',
  '不氪金也能玩', '手残党代表', '听风就是雨', '柠檬味的风', '落霞与孤鹜',
  '键盘侠本侠', '一只路过的熊', '菜就多练练', '摆烂冠军', '追星星的人',
  '没睡醒的鱼', '今天也想退游', '慢慢来不着急', '快乐老家', '三分热度玩家',
  '老阿姨打游戏', '沉默的键盘', '雨下一整晚', '白给就完事了', '手速跟不上意识',
  '菜菜的但很快乐', '半夜起来打本', '反正也打不过', '今天也要上分', '就爱玩冷门',
  '咸鱼翻身失败', '抽卡永远歪', '键盘冒烟了', '心累的老玩家', '头铁硬刚到底',
  '偶尔上线看看', '一条安静的水', '打不过就加入', '青春喂了游戏', '有空就摸两把',
  '菜得很有特色', '不服就再来一局', '佛系上分选手'
]

function buildUsers () {
  const users = []
  for (const u of KEEP_USERS) {
    users.push({ ...u, kept: true, gender: ri(0, 2), bio: null })
  }
  // 新玩家：昵称去重后建号
  const names = pickN(NEW_NAMES, Math.min(64, NEW_NAMES.length))
  const gameIds = GAMES.map(g => g.id)
  names.forEach((nick, i) => {
    const id = 1001 + i
    const favGames = pickN(gameIds, ri(1, 3))
    const favBoards = pickN([1, 2, 3, 4, 5, 6], ri(1, 3))
    const mainGame = favGames[0]
    users.push({
      id,
      username: 'yumu_' + (10000 + i * 137 + 57),
      nickname: nick,
      join: fmtD(new Date(new Date('2026-08-15T00:00:00').getTime() + ri(0, 22) * 86400000)),
      avatar: `/avatars/av-${id}.svg`,
      gender: ri(0, 2),
      bio: pick([
        '打游戏是为了开心，不是为了上分', '常年青铜，偶尔高光', '只玩喜欢的，不跟版本',
        '一天不上线浑身难受', '佛系玩家，随缘上线', '菜但爱玩，欢迎组队',
        '论技术一般，论热情不缺', '上班摸鱼，下班开黑', '游戏是生活的一部分',
        '喜欢研究机制多过打排位', '抽卡永远歪，依然热爱', '和朋友们一起玩最开心'
      ]),
      hobbies: favGames.map(id => GAME_BY_ID[id].name).join(','),
      favorite_game_ids: favGames.join(','),
      favorite_board_ids: favBoards.join(','),
      mainGame
    })
  })
  return users
}

// ============================================================================
//  四、生成主流程
// ============================================================================
function main () {
  const users = buildUsers()
  // 作者池：新玩家 + 保留号（都参与发帖）
  const authors = users.map(u => ({ id: u.id, nick: u.nickname, join: new Date(u.join + 'T08:00:00'), mainGame: u.mainGame || null }))

  // ---- 4.1 分配每个 (游戏 × 板块) 的帖子数 ----
  const gw = GAMES.reduce((s, g) => s + g.w, 0)
  const bw = Object.values(BOARD_WEIGHT).reduce((s, x) => s + x, 0)
  const plan = []
  for (const g of GAMES) {
    for (const b of [1, 2, 3, 4, 5, 6]) {
      let n = POST_TOTAL * (g.w / gw) * (BOARD_WEIGHT[b] / bw)
      n = Math.max(1, Math.round(n + (chance(0.5) ? 0.4 : -0.4)))
      for (let i = 0; i < n; i++) plan.push({ game: g, board: b })
    }
  }
  // 收敛到目标总量
  while (plan.length > POST_TOTAL) plan.splice(Math.floor(rnd() * plan.length), 1)
  while (plan.length < POST_TOTAL) {
    const g = pick(GAMES.filter(x => x.id !== 1))
    plan.push({ game: g, board: pick([1, 2, 4, 6]) })
  }

  // ---- 4.2 时间戳：站点时间窗内、越近越密、日内双高峰 ----
  const days = []
  for (let d = new Date(SITE_START); d <= NOW; d.setDate(d.getDate() + 1)) days.push(new Date(d))
  const dayW = days.map((_, i) => Math.pow(i + 3, 1.25))
  const daySum = dayW.reduce((s, x) => s + x, 0)
  const stamps = []
  days.forEach((d, i) => {
    const n = Math.max(1, Math.round(POST_TOTAL * dayW[i] / daySum))
    for (let k = 0; k < n; k++) {
      const hour = chance(0.5) ? ri(19, 23) : (chance(0.5) ? ri(12, 14) : ri(9, 18))
      const t = new Date(d); t.setHours(hour, ri(0, 59), ri(0, 59), 0)
      if (t <= NOW) stamps.push(t)
    }
  })
  while (stamps.length < POST_TOTAL) {
    const t = new Date(SITE_START.getTime() + rnd() * (NOW - SITE_START)); stamps.push(t)
  }
  stamps.sort((a, b) => a - b)

  // ---- 4.3 逐帖生成 ----
  const posts = [], replies = [], postTags = [], likes = [], favs = [], follows = [], notis = [], signs = [], pts = [], msgs = [], reports = []
  const POST_BASE = 5001, REPLY_BASE = 6001, NOTI_BASE = 2001, SIGN_BASE = 101, PTS_BASE = 5001

  let postId = POST_BASE
  let replyId = REPLY_BASE
  let notiId = NOTI_BASE
  let signSeq = 0
  let ptsSeq = 0
  let likeSeq = 0, favSeq = 0, followSeq = 0, ptSeq = 0

  const planSorted = plan
    .map((p, i) => ({ ...p, t: stamps[Math.floor(i * stamps.length / plan.length)] }))
    .sort((a, b) => a.t - b.t)

  // 每帖的点赞者集合（保证 uk 唯一）
  const likeSet = new Set()

  for (const item of planSorted) {
    const g = item.game
    const b = item.board
    const t = new Date(item.t)
    // 作者：注册时间早于发帖时间，偏向与主玩游戏一致的玩家
    const eligible = authors.filter(a => a.join <= t)
    if (!eligible.length) continue
    const pref = eligible.filter(a => a.mainGame === g.id)
    const author = chance(0.4) && pref.length ? pick(pref) : pick(eligible)

    // 状态：约 90% 正常 / 7% 待审核 / 3% 隐藏或驳回
    const roll = rnd()
    const status = roll < 0.90 ? 0 : (roll < 0.97 ? 2 : 1)
    const isEssence = status === 0 && chance(0.09)
    const isTop = status === 0 && chance(0.012)

    // 内容
    const title = titleFor(b, g)
    const body = bodyFor(b, g)
    const content = [body.open, '', body.mid, '', body.tail].join('\n') + body.extra
    const summary = content.replace(/\n+/g, ' ').slice(0, 78)

    // 封面：约 40% 有图，按板块/平台选
    let cover = ''
    if (chance(0.40)) {
      cover = b === 5 ? '/covers/creator.svg'
        : (b === 2 || b === 3 || b === 6) ? '/covers/chat.svg'
          : (b === 1 ? (chance(0.5) ? '/covers/newbie.svg' : '/covers/pc-game.svg')
            : (g.platform === '手机' ? '/covers/mobile-game.svg' : g.platform === 'PC' ? '/covers/pc-game.svg' : '/covers/console-game.svg'))
    }

    // 阅读量先留 0，等回帖/点赞生成完再按互动量反推
    // （浏览量必须和点赞/回复强相关，否则会出现"1085 浏览 1 个赞"这种一眼假的数据）
    const ageDays = Math.max(0.2, (NOW - t) / 86400000)
    let repCnt = 0, likeCnt = 0

    const postRec = {
      id: postId, user_id: author.id, board_id: b, game_id: g.id,
      title: title.slice(0, 100), content, summary, cover,
      type: BOARD_META[b].type === 2 ? 2 : (b === 1 ? (chance(0.75) ? 1 : 0) : (b === 6 && chance(0.25) ? 3 : BOARD_META[b].type)),
      status, is_top: isTop ? 1 : 0, is_essence: isEssence ? 1 : 0,
      view_count: 0, reply_count: 0, like_count: 0,
      created_at: t, updated_at: t,
      deleted: 0,
      reject_reason: status === 1 && chance(0.6) ? pick(['内容含未经证实的信息，请补充来源', '疑似引流，请修改后重新提交', '与板块主题不符']) : null,
      reviewer_id: status !== 2 ? 102 : null,
      resubmit_at: status === 2 && chance(0.2) ? new Date(t.getTime() + 3600000) : null,
      _t: t, _b: b, _g: g, _isTop: isTop, _isEssence: isEssence
    }
    posts.push(postRec)

    // ---- 标签 ----
    const tagNames = pickN(BOARD_META[b].tags, ri(1, 2))
    if (chance(0.35) && GENRE_TAG[g.id]) tagNames.push(pick(GENRE_TAG[g.id]))
    for (const tn of new Set(tagNames)) postTags.push({ post_id: postId, tag_name: tn })

    // ---- 回帖（仅可见帖）----
    // 长尾分布：多数帖子只有零星几条，少数热帖很热闹 —— 均匀高互动一眼假
    if (status === 0) {
      const rR = rnd()
      let n = rR < 0.34 ? ri(0, 2)
        : rR < 0.68 ? ri(2, 6)
          : rR < 0.90 ? ri(7, 15)
            : ri(16, 36)
      if (isEssence) n = Math.round(n * 1.6)
      if (isTop) n = Math.round(n * 2)
      n = Math.min(n, 40)
      const tops = []
      for (let k = 0; k < n; k++) {
        const rt = new Date(t.getTime() + (k + 1) * ri(20, 700) * 1000)
        if (rt > NOW) break
        const re = authors.filter(a => a.join <= rt && a.id !== author.id)
        if (!re.length) break
        const ru = pick(re)
        // 约 28% 是"楼中楼"：回复已有楼层
        const isSub = tops.length > 0 && chance(0.28)
        const parent = isSub ? pick(tops) : null
        const who = parent ? authors.find(a => a.id === parent.user_id) : null
        const text = parent
          ? fill(pick(REPLY_SUB), g, who ? who.nick : '', '')
          : fill(replyText(b), g, '', '')
        tops.push({ id: replyId, user_id: ru.id })
        replies.push({
          id: replyId, post_id: postId, user_id: ru.id, content: text,
          reply_to_id: parent ? parent.id : null,
          floor: parent ? parent.floor : tops.length,
          status: 0, like_count: 0,
          created_at: rt, updated_at: rt, deleted: 0,
          _t: rt, _g: g, _b: b
        })
        replyId++
        repCnt++
      }
    }

    // ---- 点赞 / 收藏（仅可见帖；被赞者不重复）----
    if (status === 0) {
      const lR = rnd()
      let nLike = lR < 0.42 ? ri(0, 2)
        : lR < 0.72 ? ri(3, 7)
          : lR < 0.92 ? ri(8, 18)
            : ri(19, 48)
      if (isEssence) nLike = Math.round(nLike * 1.5)
      if (isTop) nLike = Math.round(nLike * 1.8)
      nLike = Math.min(nLike, 72)
      const pool = pickN(authors.filter(a => a.id !== author.id), nLike)
      for (const lu of pool) {
        const key = `${lu.id}|1|${postId}`
        if (likeSet.has(key)) continue
        likeSet.add(key)
        likes.push({
          user_id: lu.id, target_type: 1, target_id: postId,
          created_at: new Date(Math.min(t.getTime() + ri(60, 900000) * 1000, NOW.getTime())),
          updated_at: NOW, deleted: 0
        })
        likeSeq++
        likeCnt++
      }
      // 收藏
      if (chance(0.22)) {
        for (const fu of pickN(authors.filter(a => a.id !== author.id), ri(1, 4))) {
          favs.push({ user_id: fu.id, post_id: postId, created_at: new Date(t.getTime() + ri(600, 500000) * 1000), updated_at: NOW, deleted: 0 })
        }
      }
    }

    // 阅读量 = 基础曝光（随帖子"年龄"累积）+ 互动量驱动 + 随机波动
    postRec.view_count = Math.round(
      (28 + ageDays * ri(5, 14) + repCnt * ri(26, 46) + likeCnt * ri(13, 25))
      * (0.75 + rnd() * 0.65)
    )

    postId++
  }

  // ---- 4.4 关注关系 ----
  const followSet = new Set()
  for (const u of pickN(authors, 70)) {
    for (const target of pickN(authors.filter(a => a.id !== u.id), ri(1, 4))) {
      const key = `${u.id}|1|${target.id}`
      if (followSet.has(key)) continue
      followSet.add(key)
      follows.push({ user_id: u.id, follow_type: 1, follow_id: target.id, created_at: new Date(SITE_START.getTime() + rnd() * (NOW - SITE_START)), updated_at: NOW, deleted: 0 })
    }
  }
  // 兜底：演示时会登录的那几个账号必须有关注对象，否则首页「关注」Tab 打开是空的
  for (const k of KEEP_USERS) {
    const mine = new Set(follows.filter(f => f.user_id === k.id).map(f => f.follow_id))
    const pool = authors.filter(a => a.id !== k.id && !mine.has(a.id))
    for (const target of pickN(pool, Math.max(0, 5 - mine.size))) {
      const key = `${k.id}|1|${target.id}`
      if (followSet.has(key)) continue
      followSet.add(key)
      follows.push({ user_id: k.id, follow_type: 1, follow_id: target.id, created_at: new Date(SITE_START.getTime() + rnd() * (NOW - SITE_START)), updated_at: NOW, deleted: 0 })
    }
  }

  // ---- 4.5 通知：挂在"真实发生过的互动"上（点赞/回复都是库里真有的行）----
  const visible = posts.filter(p => p.status === 0)
  const repliesByPost = {}, likersByPost = {}
  for (const r of replies) (repliesByPost[r.post_id] = repliesByPost[r.post_id] || []).push(r)
  for (const l of likes) (likersByPost[l.target_id] = likersByPost[l.target_id] || []).push(l.user_id)
  const notiKey = new Set()
  const pushNoti = (target, type, senderId, targetId, sourceId, content, when) => {
    const key = `${target}|${type}|${targetId || 0}|${sourceId || 0}`
    if (notiKey.has(key) || notis.length >= 3500) return
    notiKey.add(key)
    notis.push({
      user_id: target, type, sender_id: senderId,
      target_type: targetId ? 1 : null, target_id: targetId || null, source_id: sourceId || null,
      content: content.slice(0, 190), is_read: chance(0.62) ? 1 : 0,
      created_at: when || new Date(SITE_START.getTime() + rnd() * (NOW - SITE_START)),
      updated_at: NOW, deleted: 0
    })
  }
  // 会被打开的账号（演示时会登录的）：保留号优先派足够多的通知
  const keptIds = new Set(KEEP_USERS.map(k => k.id))
  for (const a of authors) {
    const isKept = keptIds.has(a.id)
    if (!isKept && !chance(0.6)) continue
    const mine = visible.filter(p => p.user_id === a.id)
    const cap = isKept ? 60 : 30
    let made = 0
    for (const p of mine.slice(-28).reverse()) {
      if (made >= cap) break
      // 回复通知（type=2，带 source_id 可跳楼层）
      for (const r of pickN(repliesByPost[p.id] || [], 9)) {
        pushNoti(a.id, 2, r.user_id, p.id, r.id, `回复了你的帖子：${r.content.replace(/\n/g, ' ').slice(0, 24)}`, r.created_at)
        made++
        if (made >= cap) break
      }
      // 点赞通知（type=1）
      for (const uid of pickN(likersByPost[p.id] || [], 7)) {
        pushNoti(a.id, 1, uid, p.id, null, pick(['赞了你的帖子', '觉得很赞', '点赞了你的分享']), p.created_at)
        made++
        if (made >= cap) break
      }
      if (chance(0.30)) pushNoti(a.id, 5, 102, p.id, null, '你的帖子已通过审核，已公开发布', new Date(p.created_at.getTime() + 1800000))
      if (chance(0.18)) pushNoti(a.id, 6, pick(authors).id, p.id, null, '在帖子里提到了你', p.created_at)
    }
    // 关注通知（type=3）
    for (const f of followersOf(a.id, follows)) {
      pushNoti(a.id, 3, f, null, null, '关注了你')
    }
  }
  // 人人都有公告通知
  for (const a of authors) {
    pushNoti(a.id, 4, 102, null, null, '社区最新公告：文明发言，共建良好讨论氛围', new Date('2026-09-01T10:00:00'))
  }

  // ---- 4.6 签到 / 积分流水 / 活跃度 ----
  const replyByUser = {}, likeRecvByUser = {}, essenceByUser = {}, postByUser = {}
  for (const p of posts) postByUser[p.user_id] = (postByUser[p.user_id] || 0) + 1
  for (const r of replies) replyByUser[r.user_id] = (replyByUser[r.user_id] || 0) + 1
  for (const p of posts) if (p._isEssence) essenceByUser[p.user_id] = (essenceByUser[p.user_id] || 0) + 1
  const postById = Object.fromEntries(posts.map(p => [p.id, p]))
  const likeCountByPost = {}
  for (const l of likes) likeCountByPost[l.target_id] = (likeCountByPost[l.target_id] || 0) + 1
  for (const [pid, c] of Object.entries(likeCountByPost)) {
    const uid = postById[pid] && postById[pid].user_id
    if (uid) likeRecvByUser[uid] = (likeRecvByUser[uid] || 0) + c
  }

  const points = {}
  const addPts = (uid, type, delta, desc, related) => {
    points[uid] = (points[uid] || 0) + delta
    pts.push({ id: PTS_BASE + (ptsSeq++), user_id: uid, type, delta, balance_after: points[uid], description: desc, related_id: related, created_at: new Date(SITE_START.getTime() + rnd() * (NOW - SITE_START)), updated_at: NOW, deleted: 0 })
  }
  const uidSet = authors.map(a => a.id)
  for (const uid of uidSet) {
    // 签到连续 1~12 天
    const streak = ri(1, 12)
    for (let k = 0; k < streak; k++) {
      const d = new Date(NOW); d.setDate(d.getDate() - k)
      const stamp = new Date(d); stamp.setHours(ri(7, 22), ri(0, 59), 0, 0)
      const gain = 10 + Math.min(k * 5, 50)
      signs.push({ id: SIGN_BASE + (signSeq++), user_id: uid, sign_date: fmtD(d), continuous_days: k + 1, points: gain, created_at: stamp, updated_at: stamp, deleted: 0 })
      addPts(uid, 1, gain, '每日签到奖励', null)
    }
    const np = postByUser[uid] || 0
    const nr = replyByUser[uid] || 0
    if (np) addPts(uid, 2, np * 5, `发布帖子奖励（共 ${np} 篇）`, null)
    if (nr) addPts(uid, 3, nr * 2, `回帖奖励（共 ${nr} 条）`, null)
    const lk = likeRecvByUser[uid] || 0
    if (lk) addPts(uid, 4, lk, `帖子获赞奖励（共 ${lk} 次）`, null)
    const es = essenceByUser[uid] || 0
    if (es) addPts(uid, 5, es * 20, `帖子被加精奖励（共 ${es} 篇）`, null)
  }

  // ---- 4.7 私信 / 举报（让后台面板有真实数据）----
  const msgsRaw = [
    { f: 10, t: 2, c: '老哥，你上次说的那个配装我试了下，确实好用' },
    { f: 2, t: 10, c: '哈哈那就好，有问题随时问我' },
    { f: 381, t: 380, c: '今晚还开黑吗？' },
    { f: 380, t: 381, c: '来啊，八点半上线' },
    { f: 11, t: 13, c: '你那个帖子写得好细，学到了' },
    { f: 13, t: 11, c: '过奖了，互相交流' },
    { f: 383, t: 384, c: '这期活动你抽到没？' },
    { f: 384, t: 383, c: '歪了，气死我了' }
  ]
  msgsRaw.forEach((m, i) => msgs.push({ from_user_id: m.f, to_user_id: m.t, content: m.c, is_read: chance(0.7) ? 1 : 0, created_at: new Date(SITE_START.getTime() + rnd() * (NOW - SITE_START)), updated_at: NOW, deleted: 0 }))

  const reportReasons = [
    '含广告/引流内容', '言语辱骂他人', '与板块主题不符', '疑似搬运未注明出处',
    '含不实信息', '恶意刷屏'
  ]
  for (let i = 0; i < 12; i++) {
    const target = pick(visible)
    reports.push({
      reporter_id: pick(authors).id,
      target_type: chance(0.6) ? 1 : 2,
      target_id: target.id,
      reason: pick(reportReasons),
      status: i < 7 ? 1 : 0,
      handle_note: i < 7 ? '已核实，内容无违规，驳回举报' : null,
      handler_id: i < 7 ? 102 : null,
      created_at: new Date(SITE_START.getTime() + rnd() * (NOW - SITE_START)), updated_at: NOW, deleted: 0
    })
  }

  // ---- 4.8 标签 id 映射（保留库里已有干净标签 + 新增）----
  const EXISTING_TAGS = {
    单机大作: 1, 多人联机: 2, 魂系: 3, 开放世界: 4, Roguelike: 5, 二次元: 6,
    电竞: 7, 模拟经营: 8, 恐怖生存: 9, 独立游戏: 10, 手柄操作: 11, 速通攻略: 12,
    组队: 35, 萌新: 36, 活动: 37, 前瞻: 38, 技巧: 39, 攻略: 40, 日常: 41,
    杂谈: 42, 策划: 43, 吐槽大会: 44, 车队: 45, 表情包: 46, 同人: 47,
    心态: 48, 吐槽: 49, 更新: 50, 赛事: 51, 开黑: 52, 入坑: 53, 闲聊: 54,
    入门: 55, 思路: 56, bug: 57, 招募: 58, 资讯: 59, 绘画: 60, cos: 61,
    剪辑: 62, 配装: 63
  }
  const newTags = []
  let nextTagId = 69
  const tagIdOf = {}
  for (const [name, id] of Object.entries(EXISTING_TAGS)) tagIdOf[name] = id
  for (const pt of postTags) {
    if (!tagIdOf[pt.tag_name]) {
      tagIdOf[pt.tag_name] = nextTagId
      newTags.push({ id: nextTagId, name: pt.tag_name })
      nextTagId++
    }
  }

  // ---- 4.9 生成 SQL ----
  const tagUse = {}
  for (const pt of postTags) tagUse[pt.tag_name] = (tagUse[pt.tag_name] || 0) + 1
  const userPointFinal = {}, userAct = {}
  for (const uid of uidSet) {
    userPointFinal[uid] = points[uid] || 0
    userAct[uid] = (postByUser[uid] || 0) * 10 + (replyByUser[uid] || 0) * 5 + (likeRecvByUser[uid] || 0) * 2
  }
  const lvlOf = (s) => s >= 5000 ? 5 : s >= 2000 ? 4 : s >= 500 ? 3 : s >= 100 ? 2 : 1

  sql('-- ============================================================')
  sql('-- YUMU 社区演示数据重整（由 tests/seed-demo-community.mjs 生成）')
  sql(`-- 生成时间：${fmt(new Date())}   帖子总量：${posts.length}`)
  sql('-- ============================================================')
  sql('SET NAMES utf8mb4')
  sql('SET FOREIGN_KEY_CHECKS=0')
  sql('START TRANSACTION')

  // (1) 删除测试用户（保留白名单）—— 级联清掉他们名下的帖子/回帖/互动
  const keepIds = KEEP_USERS.map(u => u.id).join(',')
  sql(`DELETE FROM \`user\` WHERE id NOT IN (${keepIds})`)
  // (2) 清空全部运行时数据（含保留号的旧内容）
  for (const t of ['reply', 'post_tag', 'favorite', 'likes', 'post', 'follow', 'notification',
    'message', 'report', 'sign_in', 'points_log', 'subscription', 'moderator_board']) {
    sql(`DELETE FROM \`${t}\``)
  }
  // (3) 清理测试游戏 / 测试公告 / 测试标签
  sql('DELETE FROM `game` WHERE id >= 1000')
  sql('DELETE FROM `announcement`')
  sql('DELETE FROM `tag` WHERE id IN (32,33,34,64,65,66,67,68)')

  // (4) 新增玩家
  const newUserRows = users.filter(u => !u.kept).map(u => [
    u.id, u.username, u.nickname, PWD_HASH_123456,
    null, null, u.avatar, u.gender, u.bio, 0,
    userPointFinal[u.id] || 0, null, null,
    u.join + ' ' + pad(ri(8, 23)) + ':' + pad(ri(0, 59)) + ':' + pad(ri(0, 59)),
    fmt(NOW),
    u.hobbies, u.favorite_board_ids, u.favorite_game_ids,
    userAct[u.id] || 0, lvlOf(userAct[u.id] || 0)
  ])
  // 列顺序与 user 表定义一致
  insertMany('user', ['id', 'username', 'nickname', 'password', 'email', 'phone', 'avatar', 'gender',
    'bio', 'status', 'points', 'last_login_at', 'last_username_change_at', 'created_at', 'updated_at',
    'hobbies', 'favorite_board_ids', 'favorite_game_ids', 'activity_score', 'activity_level'], newUserRows)

  // (5) 角色 / 版主
  sql(`DELETE FROM user_role WHERE user_id NOT IN (${keepIds})`)
  insertMany('user_role', ['user_id', 'role_id'],
    users.filter(u => !u.kept).map(u => [u.id, raw("(SELECT id FROM `role` WHERE code='USER')")]))
  // 给 8 个活跃新玩家挂版主（游戏专区展示用）
  const modPick = users.filter(u => !u.kept).slice(0, 8)
  const modGames = [2, 3, 10, 19, 17, 5, 6, 16]
  modPick.forEach((u, i) => {
    sql(`INSERT INTO user_role (user_id, role_id) VALUES (${u.id}, (SELECT id FROM \`role\` WHERE code='MODERATOR'))`)
    sql(`INSERT INTO moderator_board (user_id, board_id, game_id, created_at, updated_at, deleted) VALUES (${u.id}, NULL, ${modGames[i]}, '2026-08-26 10:00:00', '2026-08-26 10:00:00', 0)`)
  })
  // 保留号的既有版主任命
  for (const [uid, gid] of [[2, 19], [222, 2], [15, 2], [14, 2], [13, 2], [12, 2], [671, 18]]) {
    sql(`INSERT INTO moderator_board (user_id, board_id, game_id, created_at, updated_at, deleted) VALUES (${uid}, NULL, ${gid}, '2026-08-26 10:00:00', '2026-08-26 10:00:00', 0)`)
  }

  // (6) 帖子
  insertMany('post', ['id', 'user_id', 'board_id', 'game_id', 'title', 'content', 'summary', 'cover',
    'type', 'status', 'is_top', 'is_essence', 'view_count', 'reply_count', 'like_count',
    'created_at', 'updated_at', 'deleted', 'reject_reason', 'reviewer_id', 'resubmit_at'],
  posts.map(p => [p.id, p.user_id, p.board_id, p.game_id, p.title, p.content, p.summary, p.cover,
    p.type, p.status, p.is_top, p.is_essence, p.view_count, 0, 0,
    fmt(p.created_at), fmt(p.updated_at), 0, p.reject_reason, p.reviewer_id, p.resubmit_at ? fmt(p.resubmit_at) : null]))

  // (7) 回帖
  insertMany('reply', ['id', 'post_id', 'user_id', 'content', 'reply_to_id', 'floor', 'status',
    'like_count', 'created_at', 'updated_at', 'deleted'],
  replies.map(r => [r.id, r.post_id, r.user_id, r.content, r.reply_to_id, r.floor, 0, 0,
    fmt(r.created_at), fmt(r.updated_at), 0]))

  // (8) 帖子标签
  insertMany('post_tag', ['id', 'post_id', 'tag_id'],
    postTags.map((pt, i) => [900000 + i, pt.post_id, tagIdOf[pt.tag_name]]))

  // (9) 新增标签
  if (newTags.length) {
    insertMany('tag', ['id', 'name', 'use_count', 'created_at', 'updated_at', 'deleted'],
      newTags.map(t => [t.id, t.name, tagUse[t.name] || 0, '2026-08-16 10:00:00', '2026-08-16 10:00:00', 0]))
  }

  // (10) 点赞 / 收藏 / 关注
  insertMany('likes', ['id', 'user_id', 'target_type', 'target_id', 'created_at', 'updated_at', 'deleted'],
    likes.map((l, i) => [100000 + i, l.user_id, l.target_type, l.target_id, fmt(l.created_at), fmt(l.updated_at), 0]))
  insertMany('favorite', ['id', 'user_id', 'post_id', 'created_at', 'updated_at', 'deleted'],
    favs.map((f, i) => [100000 + i, f.user_id, f.post_id, fmt(f.created_at), fmt(f.updated_at), 0]))
  insertMany('follow', ['id', 'user_id', 'follow_type', 'follow_id', 'created_at', 'updated_at', 'deleted'],
    follows.map((f, i) => [100000 + i, f.user_id, f.follow_type, f.follow_id, fmt(f.created_at), fmt(f.updated_at), 0]))

  // (11) 通知 / 签到 / 积分
  insertMany('notification', ['user_id', 'type', 'sender_id', 'target_type', 'target_id',
    'source_id', 'content', 'is_read', 'created_at', 'updated_at', 'deleted'],
  notis.map(n => [n.user_id, n.type, n.sender_id, n.target_type, n.target_id,
    n.source_id, n.content, n.is_read, fmt(n.created_at), fmt(n.updated_at), 0]))
  insertMany('sign_in', ['id', 'user_id', 'sign_date', 'continuous_days', 'points', 'created_at', 'updated_at', 'deleted'],
    signs.map(s => [s.id, s.user_id, s.sign_date, s.continuous_days, s.points, fmt(s.created_at), fmt(s.updated_at), 0]))
  insertMany('points_log', ['id', 'user_id', 'type', 'delta', 'balance_after', 'description', 'related_id',
    'created_at', 'updated_at', 'deleted'],
  pts.map(p => [p.id, p.user_id, p.type, p.delta, p.balance_after, p.description, p.related_id,
    fmt(p.created_at), fmt(p.updated_at), 0]))
  insertMany('message', ['from_user_id', 'to_user_id', 'content', 'is_read', 'created_at', 'updated_at', 'deleted'],
    msgs.map(m => [m.from_user_id, m.to_user_id, m.content, m.is_read, fmt(m.created_at), fmt(m.updated_at), 0]))
  insertMany('report', ['reporter_id', 'target_type', 'target_id', 'reason', 'status', 'handle_note',
    'handler_id', 'created_at', 'updated_at', 'deleted'],
  reports.map(r => [r.reporter_id, r.target_type, r.target_id, r.reason, r.status, r.handle_note,
    r.handler_id, fmt(r.created_at), fmt(r.updated_at), 0]))

  // (12) 公告
  const anns = [
    ['欢迎来到 YUMU 游戏社区', 'YUMU 是一个面向所有玩家的游戏交流社区。这里可以分享攻略心得、吐槽游戏体验、寻找开黑队友、获取最新游戏资讯，也欢迎发布你的二次创作。\n\n请遵守社区规范：理性讨论、友善发言、不发布违规内容。祝大家玩得开心！', 1, 1],
    ['社区发帖与互动规范（2026 修订版）', '为维护良好的讨论氛围，请遵守以下规范：\n\n1. 发帖前请选择正确的板块与游戏分区，标题需能概括内容；\n2. 禁止发布广告、引流、涉黄涉暴及违法违规内容；\n3. 禁止人身攻击、恶意引战、刷屏；\n4. 转载内容请注明出处；\n5. 组队类帖子请注明时间、平台与需求人数。\n\n违规内容将视情节予以隐藏、驳回或封禁处理。', 1, 2],
    ['8 月社区数据小结', '过去一个月里，社区新增了大量帖子与讨论，感谢每一位认真分享的玩家。\n\n热门板块依次是：攻略心得、游戏吐槽、资讯速递。\n\n接下来我们会继续优化移动端体验，并上线收藏夹分组、草稿箱等功能，敬请期待。', 1, 3],
    ['关于图片上传与内容安全说明', '为保障大家的使用体验，社区已启用内容净化与图片上传校验：\n\n· 帖子正文中的链接会经过安全过滤，仅允许站内链接与可信协议；\n· 图片上传会进行类型与大小校验，并自动压缩生成缩略图；\n· 所有待审核内容会在审核通过后才对外可见。\n\n如遇误判，可在帖子下留言或联系管理员。', 0, 4],
    ['组队大厅使用指南', '发组队帖时，建议在标题或正文中写清以下几点，能显著提高成队效率：\n\n1. 游戏名称与具体的玩法/模式；\n2. 上线时间与大概时长；\n3. 需求人数与位置需求；\n4. 平台（手机 / PC / 主机）与是否语音。\n\n祝大家都能找到靠谱队友。', 0, 5],
    ['新版「游戏专区」上线', '游戏专区已支持按游戏查看该游戏下的全部板块与热门帖，并可看到每个游戏的版主与活跃玩家。\n\n目前收录 19 款热门游戏，后续会持续增加。你希望新增哪款游戏？欢迎在评论区告诉我们。', 0, 6]
  ]
  insertMany('announcement', ['title', 'content', 'status', 'is_top', 'sort', 'created_by', 'created_at', 'updated_at', 'deleted'],
    // ⚠️ announcement.status 语义是 0=展示 / 1=隐藏（与 post.status 的 0=正常不同名但同向），
    //    写成 1 会让公开接口 /announcements 返回空数组 —— 已踩过，勿改。
    anns.map((a, i) => [a[0], a[1], 0, a[2], a[3], 102,
      fmt(new Date(SITE_START.getTime() + (i + 1) * 4 * 86400000)), fmt(NOW), 0]))

  // (13) 重算全部计数列 —— 前端首页/板块页/游戏专区/详情页直接读这些列
  sql(`UPDATE post p SET
         p.reply_count = (SELECT COUNT(*) FROM reply r WHERE r.post_id = p.id AND r.deleted = 0 AND r.status = 0),
         p.like_count  = (SELECT COUNT(*) FROM likes l WHERE l.target_type = 1 AND l.target_id = p.id AND l.deleted = 0)`)
  sql(`UPDATE board b SET b.post_count = (
         SELECT COUNT(*) FROM post p WHERE p.board_id = b.id AND p.status = 0 AND p.deleted = 0)`)
  sql(`UPDATE game g SET g.post_count = (
         SELECT COUNT(*) FROM post p WHERE p.game_id = g.id AND p.status = 0 AND p.deleted = 0)`)
  sql(`UPDATE tag t SET t.use_count = (
         SELECT COUNT(*) FROM post_tag pt JOIN post p ON p.id = pt.post_id
         WHERE pt.tag_id = t.id AND p.status = 0 AND p.deleted = 0)`)
  for (const uid of uidSet) {
    sql(`UPDATE user SET points = ${userPointFinal[uid] || 0}, activity_score = ${userAct[uid] || 0}, activity_level = ${lvlOf(userAct[uid] || 0)} WHERE id = ${uid}`)
  }
  sql('COMMIT')
  sql('SET FOREIGN_KEY_CHECKS=1')

  const out = chunks.join(';\n') + '\n'
  const outDir = path.join(ROOT, 'db-backup')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `reseed-demo-${fmt(new Date()).replace(/[-: ]/g, '')}.sql`)
  fs.writeFileSync(outFile, out, 'utf8')

  // 头像 SVG
  const avDir = path.join(ROOT, 'frontend', 'public', 'avatars')
  fs.mkdirSync(avDir, { recursive: true })
  users.filter(u => !u.kept).forEach(u => {
    const hue = (u.id * 47) % 360
    const hue2 = (hue + 38) % 360
    const ch = u.nickname.slice(0, 1)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue},68%,58%)"/><stop offset="100%" stop-color="hsl(${hue2},72%,44%)"/>
  </linearGradient></defs>
  <rect width="120" height="120" rx="60" fill="url(#g)"/>
  <text x="60" y="60" text-anchor="middle" dominant-baseline="central"
        font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="52" fill="#fff" font-weight="600">${ch}</text>
</svg>`
    fs.writeFileSync(path.join(avDir, `av-${u.id}.svg`), svg, 'utf8')
  })

  console.log('═'.repeat(70))
  console.log(' YUMU 演示数据重整 —— 生成完成')
  console.log('═'.repeat(70))
  console.log(` 保留账号        : ${KEEP_USERS.length}`)
  console.log(` 新增玩家        : ${users.length - KEEP_USERS.length}`)
  console.log(` 帖子            : ${posts.length}  （正常 ${posts.filter(p => p.status === 0).length} / 待审 ${posts.filter(p => p.status === 2).length} / 隐藏 ${posts.filter(p => p.status === 1).length}）`)
  console.log(` 精华 / 置顶     : ${posts.filter(p => p._isEssence).length} / ${posts.filter(p => p._isTop).length}`)
  console.log(` 回帖（含楼中楼）: ${replies.length}  （楼中楼 ${replies.filter(r => r.reply_to_id).length}）`)
  console.log(` 点赞 / 收藏     : ${likes.length} / ${favs.length}`)
  console.log(` 关注 / 通知     : ${follows.length} / ${notis.length}`)
  console.log(` 签到 / 积分流水 : ${signs.length} / ${pts.length}`)
  console.log(` 标签（新增）    : ${Object.keys(tagIdOf).length} （${newTags.length}）`)
  console.log(` 公告 / 私信/举报: ${anns.length} / ${msgs.length} / ${reports.length}`)
  console.log('─'.repeat(70))
  console.log(` SQL  : ${outFile}   (${(out.length / 1024 / 1024).toFixed(1)} MB)`)
  console.log(` 头像 : frontend/public/avatars/av-*.svg  (${users.length - KEEP_USERS.length} 个)`)

  if (APPLY) {
    console.log('─'.repeat(70))
    console.log(' 正在写入数据库 ...')
    const r = spawnSync('mysql', [
      `--host=${DB.host}`, `--port=${DB.port}`, `--user=${DB.user}`,
      `--password=${DB.password}`, '--default-character-set=utf8mb4',
      '--batch', DB.name
    ], { input: out, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (r.status === 0) {
      console.log(' ✅ 写入成功')
    } else {
      console.error(' ❌ 写入失败：', r.stderr || r.stdout)
      process.exit(1)
    }
  } else {
    console.log('')
    console.log(' 提示：加 --apply 直接执行，或手动导入：')
    console.log(`   mysql --default-character-set=utf8mb4 -uroot -p*** ${DB.name} < "${outFile}"`)
  }
}

main()
