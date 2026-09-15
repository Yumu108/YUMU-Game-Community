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
die()  { err "$1"; printf '\n%s发版中止（未做任何破坏性操作）。%s\n' "$C_R" "$C_0"; exit 1; }

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
      printf '%s\n' "$CHANGED" | grep -qE '^(frontend/|deploy/nginx/)' && WANT_NGINX=1
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
    note "执行方式见《上线部署操作手册》§十 表格最后一行（脚本不自动改库，避免误伤数据）"
  }
  exit 0
fi
[ -z "$PLAN" ] && die "没有需要重建的服务（MODE=$MODE）"
ok "计划重建：$PLAN"

# ---------------------------------------------------------------------------
# 4. 构建
# ---------------------------------------------------------------------------
if [ "$WANT_NGINX" -eq 1 ] || [ "$WANT_BACKEND" -eq 1 ]; then
  step "4/7 构建镜像"
  note "构建日志同时落到 $LOG，可另开会话 grep"
  note "⚠️ 前端停在 'transforming...' 是 vite 转译阶段静默，不是卡死，别 Ctrl+C"
  if [ "$WANT_BACKEND" -eq 1 ]; then
    note "后端 Maven 会逐行打日志（-B），看到 Build Success / DONE 才算完 —— 不再是黑箱"
    note "  2 核 ECS 通常 1~2 分钟。若超过 5 分钟零输出，另开一个终端跑这两行判断："
    note "    top -bn1 | head -12    有 java 在吃 CPU = 正在编译，等着即可"
    note "    free -h                swap 被打满 = 内存不够（见《日常发版手册》情况 6）"
    note "  构建期中断是安全的：旧容器一直在跑，网站不会挂"
  fi

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
      printf '\n  %s── 构建 %s ──%s\n' "$C_B" "$svc" "$C_0"
      _t0=$(date +%s)
      $DC build --progress=plain "$svc"
      rc=$?
      _dur=$(( $(date +%s) - _t0 ))
      [ "$rc" -eq 0 ] || die "$svc 构建失败（退出码 $rc，耗时 ${_dur}s）—— 完整日志：$LOG；失败前不需要回滚，旧容器还在跑"
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
  if [ "$RECREATE_BACKEND" -eq 1 ]; then
    note "--env 模式：只重建容器读取新变量，不重新编译"
    $DC up -d --force-recreate $UP_TARGETS || die "重建容器失败（$LOG）"
  else
    $DC up -d $UP_TARGETS || die "启动容器失败（$LOG）"
  fi
  ok "up -d 完成：$UP_TARGETS（mysql / redis 未触碰，数据安全）"
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
      die "nginx 起不来（$st）—— 若日志含 host not found in upstream，见《上线部署操作手册》附录 B"
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
  CODE="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE_URL/" || echo 000)"
  if [ "$CODE" = "200" ]; then
    ok "首页 HTTP 200（$BASE_URL/）"
  else
    err "首页返回 $CODE（期望 200）"
    note "502 → nginx 活着但 backend 不通；Connection refused → 80 没人听（回看上面 nginx 状态）"
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
  printf '%s\n' "$CHANGED" | grep -qE '^(frontend/|deploy/nginx/)' && [ "$WANT_NGINX" -ne 1 ]   && RECORD=0
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
