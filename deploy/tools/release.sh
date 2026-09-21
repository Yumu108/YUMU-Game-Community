#!/usr/bin/env bash
# =============================================================================
# 一键增量发版（Release）—— 服务器上执行，把「改完代码 → 上线」压成一条命令
# -----------------------------------------------------------------------------
# 这个脚本存在的唯一理由：把历史上真实踩过的坑全部变成前置判断，让发版
# 变成一件「闭眼执行也不会翻车」的事。它替你拦住的是这些错误：
#
#   ① 没 cd 到仓库就 build      → 脚本自己定位仓库根，不依赖当前目录
#   ② 忘了 git pull 直接 build  → 强制先 fetch + pull --ff-only
#   ③ 服务器上手改了跟踪文件    → 检出改动直接 FAIL，并给出恢复手法
#   ④ 只改前端却整站 --build     → 按 git diff 自动判断该重建哪个服务
#   ⑤ 网页终端断连杀掉构建      → 日志落盘 + 打印「如何防 SIGHUP」提示
#   ⑥ nginx 抢跑 Exited(1)      → up 后自检，秒退则自动 --force-recreate 补救
#   ⑦ 只看 Started 就以为成功   → 强制验 health / 80 端口 / HTTP 200 / API UP
#   ⑧ 「看着发了、其实没发」    → 以「上次发版成功的 sha」为基线判断有无新代码，
#                               空跑时明确告知「本次没构建、网站不会有变化」
#   ⑨ 宿主 80 被别人占着        → 构建全做完才在最后一步 up -d 栽跟头（宝塔自带
#                               的 nginx 抢 80）。现在改成**构建前**预检，几分钟
#                               的编译不会再白跑
#
# 用法（在服务器上，仓库根目录 /opt/yumu）：
#   bash deploy/tools/release.sh                 # 自动探测改动范围（推荐）
#   bash deploy/tools/release.sh frontend        # 强制只发前端
#   bash deploy/tools/release.sh backend         # 强制只发后端
#   bash deploy/tools/release.sh all             # 前后端都发
#   bash deploy/tools/release.sh --env           # 只改了 .env → 重建 backend 容器
#   bash deploy/tools/release.sh --dry-run       # 只打印计划，什么都不做
#
# 可选开关：
#   --no-pull       已经手动 pull 过，跳过拉取
#   --force         跳过「本地有未提交改动」的拦截（⚠️ 确认你知道后果再用）
#
# 退出码：0 = 发版成功且验收全过（也可能是「确实没新代码」的空跑，屏幕会明说）；
#         1 = 中途失败 / 验收不过。
#
# 📌 发版基线：本脚本把「验收全过的那个 commit」记在 .deploy-state/last-deployed，
#    下次据它算出「该重建哪一端」。所以**你先手动 git pull 再跑脚本也没关系**；
#    基线不存在（首次使用）时会保守地前后端全发一次。
#
# ⚠️ 防 SIGHUP：阿里云 Workbench、宝塔网页终端在断连时会给前台进程发 SIGHUP，
#    构建会被中途杀掉。发版建议这样跑（日志落地，断连也不影响）：
#       nohup bash deploy/tools/release.sh > /tmp/yumu-release.log 2>&1 &
#       tail -f /tmp/yumu-release.log
# =============================================================================
set -uo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BASE_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
LOG="/tmp/yumu-release-$(date +%Y%m%d-%H%M%S).log"
# 发版基线：记录「上一次验收全过的 commit」。判断有无新代码、该重建哪一端都以它为准，
# 而不是「本次 pull 前后 HEAD 变没变」（见步骤 2 的长注释）。
STATE_DIR="$ROOT_DIR/.deploy-state"
STATE_FILE="$STATE_DIR/last-deployed"
BASE_URL="${BASE_URL:-http://127.0.0.1}"

MODE="auto"; NO_PULL=0; DRY_RUN=0; FORCE=0
TARGETS=""

# ---------------------------------------------------------------------------
# 输出工具
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[36m'; C_D=$'\033[2m'; C_0=$'\033[0m'
else
  C_G=""; C_Y=""; C_R=""; C_B=""; C_D=""; C_0=""
fi
ok()   { printf '  %s✅ %s%s\n' "$C_G" "$1" "$C_0"; }
warn() { printf '  %s⚠️  %s%s\n' "$C_Y" "$1" "$C_0"; }
err()  { printf '  %s❌ %s%s\n' "$C_R" "$1" "$C_0"; }
note() { printf '  %s·  %s%s\n' "$C_D" "$1" "$C_0"; }
step() { printf '\n%s▶ %s%s\n' "$C_B" "$1" "$C_0"; }
die()  {
  err "$1"
  printf '\n%s✋ 发版中止。命名卷（数据库 / 上传文件）不会因此丢失，但已经重建过的服务可能停在未就绪状态（如 nginx 建好却起不来），按上面的提示处理后再重跑本脚本。%s\n' "$C_R" "$C_0"
  exit 1
}

# ---------------------------------------------------------------------------
# wait_http —— 带重试的 HTTP 探活（2026-09-21 新增，修「第 6 步假阴性」）
# ---------------------------------------------------------------------------
# 🚨 为什么必须重试：`docker compose up -d` 之后 nginx 容器**状态立刻变 `Started`**，
#   但宿主机 80 端口真正开始接连接要晚约 1 秒。第 6 步原来是「一次 curl 定生死」，
#   撞进这个窗口就拿到 `000` ⇒ `die` ⇒ 发版**其实成功了**（容器 Recreated + 全健康）
#   却中止在第 6 步，连带 6.7 的「发版基线」也不写 ⇒ 下次 diff 从旧基线算起，
#   还得人工补基线。**已实测两次**（9-21 两次发版各一次）⇒ 是**时序抖动**，不是稳定故障。
#   判据不是「有没有失败」，而是「失败是不是持续」。
# 用法：wait_http <url> <期望码> [尝试次数=10] [间隔秒=1]
#   返回 0 = 拿到期望码（结果写进 LAST_CODE / LAST_TRIES / LAST_FIRST_CODE）
#   返回 1 = 全部尝试都失败（同样写了这三个变量，供调用方打印）
wait_http() {
  local url="$1" want="$2" tries="${3:-10}" delay="${4:-1}"
  local i=1 code="000" first=""
  while [ "$i" -le "$tries" ]; do
    code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    [ -z "$first" ] && first="$code"
    if [ "$code" = "$want" ]; then
      LAST_CODE="$code"; LAST_TRIES="$i"; LAST_FIRST_CODE="$first"
      return 0
    fi
    [ "$i" -lt "$tries" ] && sleep "$delay"
    i=$((i + 1))
  done
  LAST_CODE="$code"; LAST_TRIES="$tries"; LAST_FIRST_CODE="$first"
  return 1
}

# 每一步都记录到日志（也能事后回看）
exec > >(tee -a "$LOG") 2>&1

echo "============================================================"
echo " YUMU 游戏社区 · 一键增量发版"
echo " 时间：$(date '+%Y-%m-%d %H:%M:%S')   仓库：$ROOT_DIR"
echo " 日志：$LOG"
echo "============================================================"

# ---------------------------------------------------------------------------
# 0. 参数解析
# ---------------------------------------------------------------------------
usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    frontend|backend|all) MODE="$1" ;;
    --env)      MODE="env" ;;
    --no-pull)  NO_PULL=1 ;;
    --dry-run)  DRY_RUN=1 ;;
    --force)    FORCE=1 ;;
    -h|--help)  usage ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# 1. 前置检查
# ---------------------------------------------------------------------------
step "1/7 前置检查"

cd "$ROOT_DIR" || die "无法进入仓库目录 $ROOT_DIR"
[ -d .git ] || die "$ROOT_DIR 不是 git 仓库 —— 检查是否 cd 错目录"
[ -f docker-compose.yml ] || die "找不到 docker-compose.yml —— 目录不对"

# 兼容两种安装方式：新版插件 `docker compose` / 老版独立 `docker-compose`
DC=""
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
  warn "用的是老版 docker-compose（建议升级到 compose 插件，更稳）"
else
  die "docker compose 不可用（docker 没装好或需要 sudo -i）"
fi
ok "compose 命令可用：$DC"

if [ ! -f "$ENV_FILE" ]; then
  die "$ENV_FILE 不存在 —— 先跑 bash deploy/tools/gen-secrets.sh --write"
fi
chmod 600 "$ENV_FILE" 2>/dev/null
set -a; . "$ENV_FILE"; set +a
ok "已载入 $ENV_FILE"

# 本地已跟踪文件被修改：这才是「服务器上手改代码」的元凶，会让 git pull 被拒
# （未跟踪的新文件不会造成 pull 冲突，如新建的 .env、override.yml、备份文件，只提示）
TRACKED_DIRTY="$(git status --porcelain -uno)"
UNTRACKED="$(git ls-files --others --exclude-standard)"

if [ -n "$TRACKED_DIRTY" ]; then
  if [ "$FORCE" -eq 1 ]; then
    warn "有已跟踪文件被修改（已用 --force 忽略）："
    printf '%s\n' "$TRACKED_DIRTY" | sed 's/^/     /'
  else
    err "检测到**已跟踪文件被修改** —— 服务器上不允许手改代码/配置！"
    echo
    printf '%s\n' "$TRACKED_DIRTY" | sed 's/^/     /'
    echo
    note "线上跟踪文件一律不许手改，定制内容请写进 docker-compose.override.yml（已 gitignore）"
    note "确实要保留这些改动，先暂存再发版："
    note "    git stash push -- <上面列出的路径>"
    note "    bash deploy/tools/release.sh"
    note "    git stash show -p 'stash@{0}'    # 确认改动还在"
    note "    git stash drop"
    echo
    note "若确认这些改动可以丢弃：git checkout -- . && bash deploy/tools/release.sh"
    die "工作区不干净，拒绝继续（用 --force 可绕过，但不推荐）"
  fi
else
  ok "已跟踪文件无手改（工作区干净）"
fi

if [ -n "$UNTRACKED" ]; then
  n="$(printf '%s\n' "$UNTRACKED" | wc -l)"
  note "存在 $n 个未跟踪文件（正常，如 .env / override / 备份），不影响发版："
  printf '%s\n' "$UNTRACKED" | head -5 | sed 's/^/     /'
  [ "$n" -gt 5 ] && note "    ... 其余 $((n-5)) 个略"
fi

# ---------------------------------------------------------------------------
# 2. 拉取最新代码 + 判断「到底有没有新代码要发」
# ---------------------------------------------------------------------------
# 🚨 基线**不能**用「本次 pull 前后 HEAD 变没变」—— 它回答的是「我的 pull 拉到东西了吗」，
#    而不是「线上容器是不是用当前代码构建的」。这两件事在下面场景会分道扬镳：
#      · 先手动 `git pull` 再跑本脚本（手册里就是这么教的）→ 脚本自己的 pull 无事可做
#      · 上一次发版拉到了代码，但构建/验收中途失败 → 代码在本地，镜像还是旧的
#    实测后果（2026-09-15）：脚本在第 2 步就 exit 0，**一次构建都没发生**，
#    而退出码是 0、屏幕上也没有任何「失败」字样 —— 表现就是「发了版，网站一点没变」。
#    正确基线：本机记录的「上次发版成功的 sha」（验收全过才写）vs 当前 HEAD。
step "2/7 拉取最新代码"

if [ "$NO_PULL" -eq 1 ]; then
  warn "--no-pull：跳过 git pull（用当前本地代码构建）"
elif [ "$DRY_RUN" -eq 1 ]; then
  note "[dry-run] git fetch + git pull --ff-only origin master"
else
  note "当前 HEAD：$(git rev-parse --short=8 HEAD)"

  if ! git fetch origin master 2>&1 | tail -3; then
    die "git fetch 失败 —— 检查网络（服务器访问 GitHub 不通时重试或走镜像）"
  fi
  ok "git fetch 完成"

  # --ff-only：远端有分叉时直接失败，而不是留下一个意外的 merge commit
  if ! git pull --ff-only origin master 2>&1 | tail -5; then
    die "git pull 失败 —— 若提示 local changes would be overwritten，说明服务器上有手改文件（见上一步提示）"
  fi
  ok "代码同步完成"
fi

AFTER_SHA="$(git rev-parse HEAD)"
LAST_DEPLOYED="$(cat "$STATE_FILE" 2>/dev/null | tr -d '[:space:]')"

# 基线是否可信：对象还在仓库里，且是当前 HEAD 的祖先（历史被重写/force push 时都不是）
DEPLOY_FROM=""
if [ -z "$LAST_DEPLOYED" ]; then
  warn "本机没有发版基线（$STATE_FILE 不存在）"
  note "首次用本脚本、或从旧流程切换过来时会这样 —— 本次按「前后端全发」保守处理；"
  note "验收通过后会记下基线，之后每次都能精确算出只该重建哪一端。"
elif ! git cat-file -e "${LAST_DEPLOYED}^{commit}" 2>/dev/null; then
  warn "基线提交 ${LAST_DEPLOYED} 已不在仓库中（历史被重写过？）—— 按全发处理"
elif ! git merge-base --is-ancestor "$LAST_DEPLOYED" "$AFTER_SHA" 2>/dev/null; then
  warn "基线 ${LAST_DEPLOYED} 不是当前 HEAD 的祖先（可能 force push 过）—— 按全发处理"
else
  DEPLOY_FROM="$LAST_DEPLOYED"
fi

if [ "$DEPLOY_FROM" = "$AFTER_SHA" ]; then
  ok "线上跑的就是当前代码（${AFTER_SHA:0:8}）—— 没有新代码可发"
  if [ "$MODE" = "auto" ]; then
    echo
    warn "本次没有构建任何镜像、没有替换任何容器 —— 网站不会有任何变化（正常的空跑）"
    note "想用当前代码强制重建一次：bash deploy/tools/release.sh all"
    note "只改过 .env（没改代码）：bash deploy/tools/release.sh --env"
    exit 0
  fi
  warn "但你显式指定了 $MODE，仍然继续（等价于强制重建）"
elif [ -n "$DEPLOY_FROM" ]; then
  ok "基线 ${DEPLOY_FROM:0:8} → 当前 ${AFTER_SHA:0:8}，期间新提交："
  git log --oneline "$DEPLOY_FROM..$AFTER_SHA" | sed 's/^/     /'
else
  ok "当前 ${AFTER_SHA:0:8}（无基线可比对，按全发处理）"
fi

# ---------------------------------------------------------------------------
# 3. 判断要重建哪些服务
# ---------------------------------------------------------------------------
step "3/7 判断改动范围"

# 改动面 = 上次发版成功的 sha .. 当前 HEAD。基线缺失时故意留空，
# 下面的 auto 分支会走「保守全发」——宁可贵一次，不能漏发。
CHANGED=""
if [ -n "$DEPLOY_FROM" ]; then
  CHANGED="$(git diff --name-only "$DEPLOY_FROM" "$AFTER_SHA")"
fi

WANT_NGINX=0; WANT_BACKEND=0; RECREATE_BACKEND=0
SQL_MIGRATIONS=""

case "$MODE" in
  frontend) WANT_NGINX=1 ;;
  backend)  WANT_BACKEND=1 ;;
  all)      WANT_NGINX=1; WANT_BACKEND=1 ;;
  env)      RECREATE_BACKEND=1 ;;
  auto)
    if [ -z "$CHANGED" ]; then
      warn "无法算出改动面（没有发版基线）—— 保守起见按前端 + 后端全发"
      WANT_NGINX=1; WANT_BACKEND=1
    else
      # ⚠️ miniprogram/ 与 .dockerignore 同样要触发 nginx 重建（2026-09-17 实测踩到）：
      #    小程序 H5 产物是并进 frontend/dist/m 由**同一个 nginx 镜像**托管的，
      #    只改 miniprogram/ 时若不重建 → 工具明明推了新产物，容器里却还是旧镜像，
      #    线上 /m/ 静默停留在旧版，而整条链路一路打印「成功」。
      #    只认「真正进 H5 产物的输入」（src/ + 三个构建入口），不认 docs/ 与 tests/，
      #    免得改个文档也去重启一次生产容器。.dockerignore 决定构建上下文，改了同理。
      printf '%s\n' "$CHANGED" | grep -qE '^(frontend/|miniprogram/(src/|index\.html|package\.json|vite\.config\.js)|deploy/nginx/|\.dockerignore$)' && WANT_NGINX=1
      printf '%s\n' "$CHANGED" | grep -qE '^backend/'                  && WANT_BACKEND=1
      printf '%s\n' "$CHANGED" | grep -qE '^docker-compose\.yml$'      && { WANT_NGINX=1; WANT_BACKEND=1; }
      SQL_MIGRATIONS="$(printf '%s\n' "$CHANGED" | grep -E '^backend/src/main/resources/db/[0-9]+.*\.sql$' || true)"
    fi
    ;;
esac

if [ -n "$CHANGED" ]; then
  echo "  本次改动文件（最多显示 15 个）："
  printf '%s\n' "$CHANGED" | head -15 | sed 's/^/     /'
  [ "$(printf '%s\n' "$CHANGED" | wc -l)" -gt 15 ] && note "... 其余 $(( $(printf '%s\n' "$CHANGED" | wc -l) - 15 )) 个略"
fi

PLAN=""
[ "$WANT_NGINX" -eq 1 ]   && PLAN="$PLAN nginx(含前端编译)"
[ "$WANT_BACKEND" -eq 1 ] && PLAN="$PLAN backend"
[ "$RECREATE_BACKEND" -eq 1 ] && PLAN="$PLAN backend(仅重建容器)"
if [ -z "$PLAN" ] && [ "$MODE" = "auto" ]; then
  echo
  ok "这次改动只涉及脚本/文档/备份等，**不需要重建任何容器**"
  note "（deploy/ 下的 .sh 改完即生效，直接跑就行）"
  [ -n "$SQL_MIGRATIONS" ] && {
    warn "但有 SQL 迁移文件变更，需手动执行："
    printf '%s\n' "$SQL_MIGRATIONS" | sed 's/^/     /'
    note "执行方式：手动导入（脚本不自动改库，避免误伤数据），例如："
    note "    mysql -uroot -p\"\$DB_PASSWORD\" \"\$DB_NAME\" < <上面列出的文件>"
  }
  exit 0
fi
[ -z "$PLAN" ] && die "没有需要重建的服务（MODE=$MODE）"
ok "计划重建：$PLAN"

# ---------------------------------------------------------------------------
# 3.5 宿主 80 端口占用预检（只在本机确实要重建 nginx 时才做）
# ---------------------------------------------------------------------------
# 🚨 实测事故（2026-09-15）：宝塔面板自带的 nginx 占着宿主 80，构建（后端 + 前端，
#    几分钟）全部顺利完成后，最后一步 `up -d` 才报：
#      failed to set up container networking: ... failed to bind host port
#      0.0.0.0:80/tcp: address already in use
#    → yumu-nginx 建出来却起不来（容器停在 Created），网站直接打不开，
#      而前面几分钟的编译全白跑。同一台机器上「宝塔 nginx」与「项目 nginx」
#      只能有一个占用 80，所以在**花时间之前**就把它检出来。
if [ "$WANT_NGINX" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  if ! command -v ss >/dev/null 2>&1; then
    warn "没有 ss 命令，跳过 80 端口占用预检（可 yum install -y iproute 补上）"
  else
    P80="$(ss -lntp 2>/dev/null | grep ':80 ' || true)"
    if [ -z "$P80" ]; then
      ok "80 端口空闲（可自由绑定）"
    else
      # 区分「我们自己的 yumu-nginx」与「外来的占用者」
      P80_DOCKER="$(docker ps --format '{{.Names}}	{{.Ports}}' 2>/dev/null | grep -E ':80->' || true)"
      if printf '%s\n' "$P80_DOCKER" | grep -qE '^yumu-nginx	'; then
        ok "80 被 yumu-nginx 自己占着（recreate 会先替换它，正常）"
      else
        err "80 端口已被【本项目之外】的进程占用 —— 现在继续 build，最后一定栽在 up -d"
        printf '%s\n' "$P80" | sed 's/^/     /'
        if [ -n "$P80_DOCKER" ]; then
          note "占用 80 的容器："
          printf '%s\n' "$P80_DOCKER" | sed 's/^/     /'
        fi
        echo
        note "最常见：这台机器上还跑着宝塔自带的 nginx（宿主进程，不是容器）。"
        note "  ① 停掉并禁止自启（宝塔 nginx）："
        note "       /etc/init.d/nginx stop    ||    systemctl stop nginx"
        note "       systemctl disable nginx   # 防止重启服务器后又抢回去"
        note "       ⓘ 打印 'not a native service, redirecting to systemd-sysv-install' 属正常"
        note "         （宝塔 nginx 是 init.d 脚本，systemd 自动转交）；无报错行即成功"
        note "         且 disable 只管开机自启、不停当前进程（停进程靠上面的 stop）"
        note "     也可以走面板：软件商店 → 已安装 → Nginx → 设置 → 停止服务"
        note "  ② 若上面列出的占用者是别的容器：docker stop <容器名>"
        note "  ③ 确认已释放：ss -lntp | grep ':80 '     （无输出 = 已释放）"
        note "  然后重跑：bash deploy/tools/release.sh"
        die "80 端口被占用，拒绝继续（不用等编译白跑）"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3.6 构建产物预检（C 方案必需：镜像只 COPY，产物必须先在服务器上就位）
# ---------------------------------------------------------------------------
# 🚨 Dockerfile 已退化为纯 COPY —— 产物不在时 docker 只会甩一句
#    "COPY failed: file not found in build context"，完全看不出该怎么办。
#    这里提前拦，顺带打印产物的体积/时间/前端 bundle 哈希，
#    让你能确认「要发的确实是刚构建的那一份」，而不是三天前的旧产物。
if [ "$DRY_RUN" -eq 0 ]; then
  MISSING=""

  if [ "$WANT_BACKEND" -eq 1 ]; then
    BJ="$ROOT_DIR/backend/target/yumu-community-1.0.0.jar"
    if [ -f "$BJ" ]; then
      ok "后端产物就位：$(du -h "$BJ" | cut -f1) / $(stat -c %y "$BJ" 2>/dev/null | cut -c1-16)"
    else
      MISSING="$MISSING backend(jar)"
    fi
  fi

  if [ "$WANT_NGINX" -eq 1 ]; then
    FD="$ROOT_DIR/frontend/dist"
    if [ -f "$FD/index.html" ]; then
      BUNDLE="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$FD/index.html" 2>/dev/null | head -1)"
      ok "前端产物就位：$(du -sh "$FD" | cut -f1) / bundle ${BUNDLE:-未知}"
    else
      MISSING="$MISSING frontend(dist)"
    fi
  fi

  if [ -n "$MISSING" ]; then
    err "缺构建产物：$MISSING —— 镜像只做 COPY，没有产物就无法构建"
    echo
    note "正确做法：**在本机**跑一键发版（自动编译 + 推产物 + 回调本脚本）："
    note "    bash deploy/tools/deploy-local.sh"
    note "若产物已在别处构建好，手动放到位即可："
    note "    $ROOT_DIR/backend/target/yumu-community-1.0.0.jar   （本机 mvn -B -DskipTests package）"
    note "    $ROOT_DIR/frontend/dist/index.html                  （本机 npm run build）"
    note "⚠️ 不要退回「在服务器上编译」—— 本机 2 核 / 1.6Gi，跑 Maven 或 vite 会拖死整站"
    die "构建产物缺失，拒绝继续"
  fi
fi

# ---------------------------------------------------------------------------
# 4. 构建
# ---------------------------------------------------------------------------
if [ "$WANT_NGINX" -eq 1 ] || [ "$WANT_BACKEND" -eq 1 ]; then
  step "4/7 构建镜像"
  note "构建日志同时落到 $LOG，可另开会话 grep"
  note "C 方案：本步只把本机编译好的产物 COPY 进镜像，**不再编译** —— 通常几秒钟"
  note "  若这里开始出现 Compiling / vite transforming，说明 Dockerfile 被换回旧版了，"
  note "  立刻 Ctrl+C：那等于把 1.6Gi 的机器重新推回假死（正确版本见本脚本头部说明）"

  if [ "$DRY_RUN" -eq 1 ]; then
    [ "$WANT_BACKEND" -eq 1 ] && note "[dry-run] docker compose build --progress=plain backend"
    [ "$WANT_NGINX" -eq 1 ]   && note "[dry-run] docker compose build --progress=plain nginx"
  else
    # 先后端后前端：nginx 依赖 backend healthy，顺序反了会白等一轮
    for svc in backend nginx; do
      case "$svc" in
        backend) [ "$WANT_BACKEND" -eq 1 ] || continue ;;
        nginx)   [ "$WANT_NGINX" -eq 1 ]   || continue ;;
      esac
      # 降险（9-17）：构建 backend 镜像**之前**先把运行中的 backend 停掉。
      #   ① 释放约 245MB（JVM 堆 + 元空间）—— 2C2G 上这点内存就是决定性的边际；
      #   ② 镜像变了，第 5 步 up -d 本来就必然重建容器 ⇒ 这次 stop **不增加中断窗口**，
      #      只是把「反正要来的那次中断」提前几十秒。
      # 不这么做的话：build 与运行中的 JVM 抢内存，2026-09-17 实测把整机拖进假死
      # （静态页仍返回 200，但 /api 连上不回话、sshd 连 banner 都读不出）⇒ 只能控制台重启实例。
      if [ "$svc" = "backend" ]; then
        printf '\n  %s── 先停 backend 容器释放内存 ──%s\n' "$C_B" "$C_0"
        $DC stop backend >/dev/null 2>&1 || true
      fi
      printf '\n  %s── 构建 %s ──%s\n' "$C_B" "$svc" "$C_0"
      _t0=$(date +%s)
      $DC build --progress=plain "$svc"
      rc=$?
      _dur=$(( $(date +%s) - _t0 ))
      if [ "$rc" -ne 0 ]; then
        # 刚为省内存停了 backend —— 构建失败必须立刻拉回来，否则 /api 会一直挂着
        if [ "$svc" = "backend" ]; then
          warn "构建失败 —— 立即用旧镜像把 backend 拉回来，避免 API 持续不可用"
          $DC up -d backend >/dev/null 2>&1 || warn "拉回失败，请手工执行：docker compose up -d backend"
        fi
        die "$svc 构建失败（退出码 $rc，耗时 ${_dur}s）—— 完整日志：$LOG"
      fi
      ok "$svc 构建完成（耗时 ${_dur}s）"
    done
  fi
else
  step "4/7 构建镜像"
  note "本次无需构建（只重建容器）"
fi

# ---------------------------------------------------------------------------
# 5. 替换容器
# ---------------------------------------------------------------------------
step "5/7 上线（替换容器）"

UP_TARGETS=""
[ "$WANT_BACKEND" -eq 1 ] || [ "$RECREATE_BACKEND" -eq 1 ] && UP_TARGETS="$UP_TARGETS backend"
[ "$WANT_NGINX" -eq 1 ] && UP_TARGETS="$UP_TARGETS nginx"
UP_TARGETS="${UP_TARGETS# }"

if [ "$DRY_RUN" -eq 1 ]; then
  note "[dry-run] docker compose up -d $UP_TARGETS"
else
  FORCE_RECREATE=""
  [ "$RECREATE_BACKEND" -eq 1 ] && FORCE_RECREATE="--force-recreate"
  [ "$RECREATE_BACKEND" -eq 1 ] && note "--env 模式：只重建容器读取新变量，不重新编译"

  # 捕获输出：失败时要能从原文里认出具体原因（如 80 端口被占），
  # 而不是只丢一句「启动容器失败」让人自己翻日志。
  UP_OUT="$($DC up -d $FORCE_RECREATE $UP_TARGETS 2>&1)"
  UP_RC=$?
  printf '%s\n' "$UP_OUT" | sed 's/^/     /'

  if [ "$UP_RC" -ne 0 ]; then
    echo
    if printf '%s' "$UP_OUT" | grep -qi 'address already in use'; then
      err "端口冲突：宿主 80 被别的进程占着 —— nginx 容器建好了但起不来（网站当前打不开）"
      note "定位占用者："
      note "    ss -lntp | grep ':80 '"
      note "    docker ps --format '{{.Names}} -> {{.Ports}}' | grep ':80->'"
      note "宝塔自带 nginx 抢 80 时（宿主进程）：/etc/init.d/nginx stop || systemctl stop nginx"
      note "  建议顺手 systemctl disable nginx，免得重启服务器又被抢回去"
      note "释放 80 后重跑本脚本即可 —— 镜像已构建好，会走缓存，很快"
    fi
    note "当前容器状态（看清谁在跑、谁没起来）："
    $DC ps -a 2>/dev/null | sed 's/^/     /'
    die "启动容器失败（$LOG）"
  fi

  # compose 只会在「容器配置与目标不一致」时顺带重建别的服务 ——
  # 典型场景：docker-compose.yml 补了 restart 策略，而容器是在那之前创建的。
  # 这属于一次性对齐，不是脚本乱动，但要如实告知（命名卷不会被删，数据安全）。
  if printf '%s' "$UP_OUT" | grep -qE 'Container yumu-(mysql|redis) +Recreat'; then
    warn "本次顺带重建了 mysql / redis —— 说明 compose 配置变过（如补 restart 自愈策略）"
    note "命名卷未被删除，数据不受影响；这类对齐只发生一次，下次发版不会再重建"
  fi
  ok "up -d 完成，目标服务：$UP_TARGETS"
fi

# ---------------------------------------------------------------------------
# 6. 验收（关键：不看 Started，看真实状态）
# ---------------------------------------------------------------------------
step "6/7 验收"

if [ "$DRY_RUN" -eq 1 ]; then
  note "[dry-run] 跳过验收"
else
  health_of() {  # $1=容器名 → healthy / running / exited / missing
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing
  }
  wait_health() { # $1=容器名 $2=超时秒 → 0 就绪
    local c="$1" limit="${2:-180}" waited=0 st
    while [ "$waited" -lt "$limit" ]; do
      st="$(health_of "$c")"
      case "$st" in healthy|running) printf '\r  %s✅ %s 就绪（%s）%s\n' "$C_G" "$c" "$st" "$C_0"; return 0 ;; esac
      printf '\r  %s·  等待 %s 就绪… %ss（当前 %s）%s' "$C_D" "$c" "$waited" "$st" "$C_0"
      sleep 3; waited=$((waited+3))
    done
    printf '\r%*s\r' 90 ''
    return 1
  }

  # 6.1 backend
  if [ "$WANT_BACKEND" -eq 1 ] || [ "$RECREATE_BACKEND" -eq 1 ]; then
    # 等它先脱离 restarting 状态
    sleep 5
    if ! wait_health yumu-backend 240; then
      err "backend 未在 240s 内就绪（当前 $(health_of yumu-backend)）"
      echo "  ── backend 最近日志 ──"
      $DC logs --tail=30 backend | sed 's/^/     /'
      note "常见原因：.env 缺必填变量 / 密钥强度不够被启动自检拒绝 / logs 目录属主不对"
      note "  修 logs 属主：sudo chown -R 1000:1000 $ROOT_DIR/logs"
      die "验收失败：backend 没起来"
    fi
  fi

  # 6.2 nginx —— 这里专门拦「host not found in upstream → Exited(1)」那个老坑
  if [ "$WANT_NGINX" -eq 1 ]; then
    st="$(health_of yumu-nginx)"
    if [ "$st" != "running" ]; then
      warn "yumu-nginx 当前 $st —— 触发自动补救（--force-recreate，刷新网络挂载）"
      $DC up -d --force-recreate nginx >/dev/null 2>&1
      sleep 5
      st="$(health_of yumu-nginx)"
    fi
    if [ "$st" != "running" ]; then
      # 再兜一层：整体重排网络（绝不加 -v，命名卷保留）
      warn "仍未 running（$st）—— 尝试整体重排网络：docker compose down && up -d（⚠️ 不带 -v）"
      $DC logs --tail=20 nginx | sed 's/^/     /'
      $DC down >/dev/null 2>&1
      $DC up -d $UP_TARGETS >/dev/null 2>&1
      sleep 8
      st="$(health_of yumu-nginx)"
    fi
    if [ "$st" != "running" ]; then
      $DC logs --tail=20 nginx | sed 's/^/     /'
      die "nginx 起不来（$st）—— 若日志含 host not found in upstream，说明 compose 的 depends_on 没等 backend healthy，见 docker-compose.yml 里 yumu-nginx 的注释"
    fi
    ok "yumu-nginx 运行中"
  fi

  # 6.3 端口 80 真有人监听（Started ≠ 监听，这是老坑）
  if command -v ss >/dev/null 2>&1; then
    if ss -lntp 2>/dev/null | grep -q ':80 '; then
      ok "80 端口已监听"
    else
      die "80 端口没有监听 —— 别只看 compose 的 Started，用 ss -lntp | grep ':80 ' 复核"
    fi
  else
    warn "没有 ss 命令，跳过端口检查（可 yum install -y iproute）"
  fi

  # 6.4 首页可访问
  # ⚠️ 用 wait_http 而不是单次 curl（见它的注释）：`up -d` 返回后 nginx 虽已 `Started`，
  #    宿主机 80 真正开始接连接要晚约 1 秒；一次 curl 定生死会把「已发成功」误判成失败。
  if wait_http "$BASE_URL/" 200 10 1; then
    if [ "$LAST_TRIES" -gt 1 ]; then
      ok "首页 HTTP 200（$BASE_URL/，第 ${LAST_TRIES} 次探测才通 —— up -d 后的启动窗口，非故障）"
    else
      ok "首页 HTTP 200（$BASE_URL/）"
    fi
  else
    err "首页返回 $LAST_CODE（期望 200；连续探测 ${LAST_TRIES} 次，首次 $LAST_FIRST_CODE）"
    note "502 → nginx 活着但 backend 不通；Connection refused → 80 没人听（回看上面 nginx 状态）"
    note "若首次 000 之后一直是 000，才说明是真故障（抖动只发生在最初约 1 秒）"
    die "验收失败：首页不可访问"
  fi

  # 6.5 后端 API 真在跑
  HEALTH_BODY="$(curl -s -m 10 "$BASE_URL/api/actuator/health" || echo '')"
  if printf '%s' "$HEALTH_BODY" | grep -q '"UP"'; then
    ok "API 健康：$HEALTH_BODY"
  else
    err "API 健康检查异常：${HEALTH_BODY:-（无响应）}"
    die "验收失败：后端健康端点未返回 UP"
  fi

  # 6.6 真实接口返回真数据（比 health 更能说明问题）
  BOARDS_LEN="$(curl -s -m 10 "$BASE_URL/api/boards" | head -c 200 | wc -c)"
  if [ "$BOARDS_LEN" -gt 20 ]; then
    ok "业务接口 /api/boards 有返回"
  else
    warn "/api/boards 返回内容异常偏少 —— 手动开一次页面确认数据是否正常"
  fi
fi

# ---------------------------------------------------------------------------
# 6.7 记录发版基线（只有「验收全过」才写；中途失败不写 → 下次重跑不会漏发）
# ---------------------------------------------------------------------------
RECORD=1
[ "$DRY_RUN" -eq 1 ] && RECORD=0
# --env 只重建容器、不重新编译，镜像未必等于当前代码 → 不能算「这一版已上线」
[ "$RECREATE_BACKEND" -eq 1 ] && RECORD=0
# 手动指定范围时，只有把改动面**完整覆盖**了，才能说「当前代码已上线」
if [ "$MODE" != "auto" ] && [ -n "$CHANGED" ]; then
  printf '%s\n' "$CHANGED" | grep -qE '^(frontend/|miniprogram/(src/|index\.html|package\.json|vite\.config\.js)|deploy/nginx/|\.dockerignore$)' && [ "$WANT_NGINX" -ne 1 ] && RECORD=0
  printf '%s\n' "$CHANGED" | grep -qE '^backend/'                  && [ "$WANT_BACKEND" -ne 1 ] && RECORD=0
fi

if [ "$RECORD" -eq 1 ]; then
  mkdir -p "$STATE_DIR" 2>/dev/null
  if printf '%s\n' "$AFTER_SHA" > "$STATE_FILE" 2>/dev/null; then
    printf '%s  %s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$AFTER_SHA" "${UP_TARGETS:-none}" \
      >> "$STATE_DIR/history.log" 2>/dev/null
    note "已记下发版基线 ${AFTER_SHA:0:8}（下次据此算出改动面）"
  else
    warn "写基线失败（$STATE_FILE）—— 不影响本次上线，但下次会按「全发」处理"
  fi
elif [ "$DRY_RUN" -eq 1 ]; then
  note "[dry-run] 不写发版基线"
else
  warn "本次**未记**发版基线（--env 或只发了局部）—— 下次仍会按改动面判断，不会漏发"
fi

# ---------------------------------------------------------------------------
# 7. 汇总
# ---------------------------------------------------------------------------
step "7/7 完成"
$DC ps 2>/dev/null | sed 's/^/  /'
echo
if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s🧪 dry-run 结束：以上只是计划 —— 没有拉代码、没有构建、没有动任何容器。%s\n' "$C_Y" "$C_0"
  printf '%s   去掉 --dry-run 即真正执行。%s\n' "$C_D" "$C_0"
  exit 0
fi
printf '%s✅ 发版成功。访问：%s/   （域名未备案期间用 IP）%s\n' "$C_G" "$BASE_URL" "$C_0"
printf '%s   已上线版本：%s   完整日志：%s%s\n' "$C_D" "${AFTER_SHA:0:8}" "$LOG" "$C_0"
exit 0
