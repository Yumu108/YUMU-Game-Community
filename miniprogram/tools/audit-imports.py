#!/usr/bin/env python
"""导入审计 —— 抓「用了某个符号，但忘了 import」这类**静默故障**。

为什么要这个脚本（2026-09-17 真实踩到）：
  `PostCard.vue` 里写了 `platformLabel(post.platform)` 却没把它加进 format 的 import。
  构建**完全不报错**（uni-app 不做类型检查），页面也照常渲染 —— 只是平台角标一个都不出来。
  回归里 A9「首屏卡片带平台角标」直接 0 个，才把它揪出来。
  这类错误在浏览器里只表现为「某个元素凭空消失」，很容易被当成「没数据」。

用法：
    cd miniprogram
    python tools/audit-imports.py            # 扫 src/
    python tools/audit-imports.py --self-test  # 只验工具本身（不扫项目）

检查范围（符号级，够用且零依赖）：
  对每个 .vue / .js，取它**去掉注释后**引用的跨模块符号，检查是否在该文件的
  import / 本地声明 / 再导出 里出现过。

⚠️ 上一版 45 条告警里 40 条是误报，真问题被淹掉 —— 一个信噪比太低的检查等于没有检查。
   这次修掉的三类误报来源：
     ① 注释里提到符号名（如「与 SORT 常量保持一致」）→ **先去注释再扫**；
     ② `export { queryIndex, ... } from './guideQuery'` 的**再导出** → 也算已声明；
     ③ 模板里的 Vue 组件（easycom 按 `components/` 目录自动注册，本就不需要 import）
        → 组件名**不进** SYMBOLS 清单。
"""
import io
import os
import re
import sys

# 「一旦出现就必须 import」的跨模块符号（utils / api / 常量）
#
# ⚠️ 故意**不收录 Vue 组件名**（PostCard / EmptyState / PlatformFilter / StepCard /
#    GameTile / Skeleton）：uni-app 的 easycom 会按 `components/` 自动注册，
#    模板里写 <PostCard> 不需要 import —— 收进来只会制造误报。
SYMBOLS = [
    # utils
    'platformLabel', 'resolveImage', 'formatTime', 'shortNumber', 'gameTile', 'summaryOf',
    'contentBlocks', 'parseReading', 'addHistory', 'getHistory', 'clearHistory', 'getFavorites',
    'isFavorite', 'toggleFavorite', 'getLikes', 'isLiked', 'toggleLike', 'clearLikes',
    'ensureIndex', 'ensureGameMeta', 'ensureGameMetaCached', 'readCachedIndex',
    'queryIndex', 'countByPlatform', 'indexStats', 'relatedOf', 'hotScore', 'cmpLatest',
    'usePagedList',
    # api
    'fetchPosts', 'fetchGames', 'fetchGameDetail', 'fetchGamePosts', 'fetchPostDetail',
    'fetchPostTags', 'fetchAnnouncements', 'fetchDailyPicks', 'fetchHotTags', 'searchAll',
    'fetchReplies', 'fetchBoards',
    # 常量
    'PLATFORM_TABS', 'PLATFORM_HINT', 'GUIDE_BOARDS', 'SORT', 'BOARD', 'PLATFORM',
    'ASSET_BASE', 'API_BASE', 'STORAGE_KEYS',
]

BACKSLASH = chr(92)
IMPORT_RE = re.compile(r'import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\})?\s*from')
DEFINE_RE = re.compile(r'(?:^|[^.\w])(?:function|const|let|var|class)\s+([\w$]+)')
# 再导出：export { a, b as c } / export { a } from './x'  —— 同样构成「声明」
EXPORT_RE = re.compile(r'export\s*\{([^}]*)\}')
# 所有 <script> 块（有的文件既有 <script> 又有 <script setup>）
SCRIPT_RE = re.compile(r'<script[^>]*>(.*?)</script>', re.S)
BLOCK_COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)
# 行注释：`(?<!:)` 避免把 URL 里的 `http://` 当成注释起点
LINE_COMMENT_RE = re.compile(r'(?<!:)//[^\n]*')
HTML_COMMENT_RE = re.compile(r'<!--.*?-->', re.S)


def strip_comments(text):
    """去掉注释（保留换行，便于报行号时不出错）。"""
    text = BLOCK_COMMENT_RE.sub('', text)
    text = LINE_COMMENT_RE.sub('', text)
    return HTML_COMMENT_RE.sub('', text)


def script_body(raw, is_vue):
    """取要扫描的正文：.vue 取全部 <script> 块；.js 取全文。"""
    if not is_vue:
        return raw
    return '\n'.join(m.group(1) for m in SCRIPT_RE.finditer(raw))


def declared_names(body):
    """本文件里「算已声明」的符号：import、本地 function/const/let/var/class、再导出。"""
    names = set()
    for m in IMPORT_RE.finditer(body):
        if m.group(1):
            names.add(m.group(1))
        if m.group(2):
            for part in m.group(2).split(','):
                part = part.strip()
                if part:
                    names.add(part.split(' as ')[-1].strip())
    names |= set(DEFINE_RE.findall(body))
    for m in EXPORT_RE.finditer(body):
        for part in m.group(1).split(','):
            part = part.strip()
            if part:
                names.add(part.split(' as ')[-1].strip())
    return names


def scan(raw, is_vue):
    """返回该文件里「用到但没声明」的符号列表。"""
    body = strip_comments(script_body(raw, is_vue))
    if not body.strip():
        return []
    declared = declared_names(body)
    hits = []
    for sym in SYMBOLS:
        if not re.search(r'\b' + sym + r'\b', body):
            continue
        if sym in declared:
            continue
        hits.append(sym)
    return hits


def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'dist', 'unpackage')]
        for name in filenames:
            if name.endswith(('.vue', '.js')):
                yield os.path.join(dirpath, name)


def self_test():
    """防「工具本身失灵」：正例必须报、反例必须不报（本项目对兜底故障的一贯纪律）。"""
    bad = (
        '<template><view>{{ x }}</view></template>\n'
        '<script setup>\n'
        "import { formatTime } from '../utils/format'\n"
        'const t = formatTime(1)\n'
        "const label = platformLabel('PC')   /* 没 import，必须被报出来 */\n"
        '</script>\n'
    )
    good = (
        '<template><view>{{ x }}</view></template>\n'
        '<script setup>\n'
        "import { formatTime, platformLabel } from '../utils/format'\n"
        'const t = formatTime(1)\n'
        "const label = platformLabel('PC')\n"
        '</script>\n'
    )
    # ③ 注释里出现符号名 → 不算「用到」
    commented = (
        '<script setup>\n'
        "import { ensureIndex } from '../utils/guideIndex'\n"
        '// 这里跟 SORT 的口径保持一致（只是注释，不该报警）\n'
        'ensureIndex()\n'
        '</script>\n'
    )
    # ② 再导出 → 算已声明
    reexport = (
        "<script setup>\n"
        "import { ensureIndex } from '../utils/guideIndex'\n"
        "export { queryIndex, countByPlatform } from '../utils/guideQuery'\n"
        'ensureIndex()\n'
        '</script>\n'
    )
    # ③ easycom 组件名不在清单里 → 模板里用组件不该被报
    easycom = (
        '<template><PostCard :post="p" /><EmptyState /></template>\n'
        '<script setup>\n'
        'const p = {}\n'
        '</script>\n'
    )

    cases = [
        ('正例：用了 platformLabel 却没 import', scan(bad, True), ['platformLabel']),
        ('反例：已 import，不该报', scan(good, True), []),
        ('反例：只在注释里提到 SORT，不该报', scan(commented, True), []),
        ('反例：再导出的符号算已声明', scan(reexport, True), []),
        ('反例：模板里的 easycom 组件不该报', scan(easycom, True), []),
    ]
    ok = True
    for name, got, want in cases:
        hit = got == want
        ok = ok and hit
        print(('  ✅ ' if hit else '  ❌ ') + name + '  [得到 ' + str(got) + '，期望 ' + str(want) + ']')
    print(('✅ 自检通过' if ok else '❌ 自检失败：审计工具本身不可信，先修工具') + '（' + str(len(cases)) + ' 例）')
    return 0 if ok else 1


def main():
    root = os.path.normpath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')
    )
    problems = []
    scanned = 0
    for fp in sorted(iter_files(root)):
        raw = io.open(fp, encoding='utf-8').read()
        is_vue = fp.endswith('.vue')
        if is_vue and not SCRIPT_RE.search(raw):
            continue
        scanned += 1
        for sym in scan(raw, is_vue):
            problems.append((fp.replace(BACKSLASH, '/'), sym))

    rel = lambda p: os.path.relpath(p, root).replace(BACKSLASH, '/')
    for fp, sym in problems:
        print('❌ ' + rel(fp) + '  用到 `' + sym + '` 但没有 import')
    if problems:
        print('\n共 ' + str(len(problems)) + ' 处遗漏（扫了 ' + str(scanned) + ' 个文件）'
              ' —— 这类问题构建不报错、只表现为「元素凭空消失」。')
        return 1
    print('✅ 导入审计通过：' + str(scanned) + ' 个文件里没有「用了却没 import」的符号')
    return 0


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        sys.exit(self_test())
    sys.exit(main())
