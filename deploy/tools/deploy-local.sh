#!/usr/bin/env bash
# =============================================================================
# 本机一键发版（C 方案）—— 本机编译 → 推产物 → 服务器只组装
# -----------------------------------------------------------------------------
# 为什么不是「服务器上跑 release.sh」了（2026-09-16 定案）：
#   线上 ECS 是 2 核 / **可用内存仅 1.6Gi**，常驻的 mysql(368M) + java(245M) +
#   宝塔面板(105M) + dockerd/containerd/阿里云盾(≈110M) 已吃掉约 820M。在这台机器上
#   再跑一次 Maven（-Xmx768m + Metaspace 320m）或 vite build，必然把内存打爆 → 狂刷
#   swap → 整机假死（实测 /api 连续 90s 不响应、连 nginx 都抢不到 CPU、站点无应答）。
#   本机编译反而快得多：mvn package ≈ 17s、npm run build ≈ 8.5s。
#
#   ⇒ 从此「编译在本机、服务器只 COPY 产物」。服务器上的 Dockerfile 已退化为纯
#     COPY（见 backend/Dockerfile、deploy/nginx/Dockerfile 顶部说明）。
#
# 用法（在**本机**仓库根目录）：
#   bash deploy/tools/deploy-local.sh                 # 自动判断该发前端还是后端（推荐）
#   bash deploy/tools/deploy-local.sh frontend        # 只发前端
#   bash deploy/tools/deploy-local.sh backend         # 只发后端
#   bash deploy/tools/deploy-local.sh all             # 前后端都发
#   bash deploy/tools/deploy-local.sh --dry-run       # 只打印计划，不构建不推送
#   bash deploy/tools/deploy-local.sh --reuse-build   # 不重新编译，直接推现有产物
#   bash deploy/tools/deploy-local.sh --no-push       # 跳过 git push + 服务器 pull
#   bash deploy/tools/deploy-local.sh --bundle        # 强制走 git bundle 直传（GitHub 不可达时）
#   bash deploy/tools/deploy-local.sh --allow-dirty   # 工作区有未提交改动也继续（不推荐）
#
# 关于 GitHub：本机访问 github.com:443 常被墙（需要开着 Clash）。push 失败时脚本会
#   **自动回退**到 `git bundle` 直传 —— 把增量提交打成 bundle 走 SSH 送到服务器再 pull，
#   完全不经过 GitHub。代价是 GitHub 上的仓库会落后，等代理恢复时记得补一次：
#       git push origin master
#
# 前置条件（一次性）：
#   1) 本机已装好 SSH 公钥到服务器：
#        SSH_PASSWORD=<root密码> python deploy/tools/ssh_bootstrap_key.py
#   2) 服务器基础镜像已就位（eclipse-temurin:21-jre / nginx:1.27-alpine）
#
# 可用环境变量覆盖：DEPLOY_HOST / DEPLOY_USER / DEPLOY_DIR / SSH_KEY / BASE_URL / JAVA_HOME
#
# 退出码：0 = 发版成功且验收全过；1 = 中途失败。
# =============================================================================
set -uo pipefail

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BASE_DIR/../.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-8.133.255.202}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/yumu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
BASE_URL="${BASE_URL:-http://$DEPLOY_HOST}"
JAR_NAME="yumu-community-1.0.0.jar"
BACKEND_JAR="$ROOT_DIR/backend/target/$JAR_NAME"
FRONTEND_DIST="$ROOT_DIR/frontend/dist"
MAVEN_BIN="${MAVEN_BIN:-D:\\maven\\apache-maven-3.9.9\\bin\\mvn.cmd}"

MODE=auto; DO_PUSH=1; DRY=0; ALLOW_DIRTY=0; SKIP_BUILD=0; FORCE_BUNDLE=0

SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new
          -o ConnectTimeout=15 -o ServerAliveInterval=15 -o LogLevel=ERROR)
SCP_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new
          -o ConnectTimeout=15 -o LogLevel=ERROR)

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
die()  { err "$1"; printf '\n%s✋ 发版中止。线上服务没有被中断（失败发生在替换容器之前时，旧容器仍在跑）。%s\n' "$C_R" "$C_0"; exit 1; }

# 在服务器上执行命令（stdin 可传 heredoc 脚本）
R() { ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$@"; }
RS() { ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" 'bash -s'; }

T0=$(date +%s)
echo "============================================================"
echo " YUMU 游戏社区 · 本机一键发版（C 方案）"
echo " 时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo " 本机：$ROOT_DIR"
echo " 目标：$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR"
echo "============================================================"

# ---------------------------------------------------------------------------
# 0. 参数解析
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    frontend|backend|all) MODE="$1" ;;
    --no-push)     DO_PUSH=0 ;;
    --bundle)      FORCE_BUNDLE=1 ;;
    --dry-run)     DRY=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --reuse-build) SKIP_BUILD=1 ;;
    -h|--help)     sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# 1. 前置检查
# ---------------------------------------------------------------------------
step "1/7 前置检查"

cd "$ROOT_DIR" || die "无法进入仓库目录 $ROOT_DIR"
[ -d .git ] || die "$ROOT_DIR 不是 git 仓库"

for c in git ssh scp tar curl; do
  command -v "$c" >/dev/null 2>&1 || die "本机缺少命令：$c（Git Bash 自带这些，检查 PATH）"
done
ok "本机命令齐备（git / ssh / scp / tar / curl）"

[ -f "$SSH_KEY" ] || die "找不到 SSH 私钥 $SSH_KEY —— 先跑：
       SSH_PASSWORD=<服务器root密码> python deploy/tools/ssh_bootstrap_key.py"
chmod 600 "$SSH_KEY" 2>/dev/null

if [ "$DRY" -eq 1 ]; then
  note "[dry-run] 跳过与服务器的连通性检查"
else
  REMOTE_UNAME="$(R 'echo OK; hostname; nproc' 2>&1 | tail -3)" || true
  if ! printf '%s' "$REMOTE_UNAME" | grep -q '^OK$'; then
    err "SSH 免密登录失败："
    printf '%s\n' "$REMOTE_UNAME" | sed 's/^/     /'
    die "连不上 $DEPLOY_USER@$DEPLOY_HOST —— 检查密钥是否已装（ssh_bootstrap_key.py）、服务器是否开机"
  fi
  ok "SSH 免密通道正常（$(printf '%s' "$REMOTE_UNAME" | tr '\n' ' ')）"
fi

# 工作区干净度：产物必须对应某个 commit，否则「线上跑的到底是哪版代码」就说不清了
DIRTY="$(git status --porcelain -uno)"
if [ -n "$DIRTY" ]; then
  if [ "$ALLOW_DIRTY" -eq 1 ]; then
    warn "有已跟踪文件被修改（已用 --allow-dirty 忽略）—— 本次产物不对应任何 commit："
    printf '%s\n' "$DIRTY" | sed 's/^/     /'
  else
    err "检测到**已跟踪文件被修改** —— 产物将无法对应到确定的 commit"
    printf '%s\n' "$DIRTY" | sed 's/^/     /'
    echo
    note "两种选择："
    note "  ① 先提交：git add -A && git commit -m \"...\" && bash deploy/tools/deploy-local.sh"
    note "  ② 确认无所谓：bash deploy/tools/deploy-local.sh --allow-dirty"
    die "工作区不干净，拒绝发版"
  fi
else
  ok "工作区干净（本地 HEAD：$(git rev-parse --short=8 HEAD)）"
fi

# 构建工具（要编译时才检查）
if [ "$SKIP_BUILD" -eq 0 ] && [ "$DRY" -eq 0 ]; then
  command -v node >/dev/null 2>&1 || die "本机没有 node（前端构建需要）"
  [ -f "$MAVEN_BIN" ] || [ -n "$(command -v mvn 2>/dev/null)" ] || die "找不到 Maven（设 MAVEN_BIN 环境变量指向 mvn）"
  note "node $(node -v) / Maven $(basename "$MAVEN_BIN")"
fi

# ---------------------------------------------------------------------------
# 2. 算改动范围（以服务器上的「上次发版成功基线」为准）
# ---------------------------------------------------------------------------
step "2/7 判断改动范围"

HEAD_SHA="$(git rev-parse HEAD)"
# 即使 --dry-run 也去读一次基线（纯只读操作）—— 这样打印出来的发版计划才是**真实的**，
# 而不是退化成一个没意义的近似值。SSH 不通时回落到 HEAD~1 并给出警告。
REMOTE_BASE="$(R "cat $DEPLOY_DIR/.deploy-state/last-deployed 2>/dev/null" 2>/dev/null | tr -d '[:space:]')" || true
[ -z "$REMOTE_BASE" ] && REMOTE_BASE="$(git rev-parse HEAD~1 2>/dev/null || echo '')"

CHANGED=""
if [ -n "$REMOTE_BASE" ] && git cat-file -e "${REMOTE_BASE}^{commit}" 2>/dev/null; then
  CHANGED="$(git diff --name-only "$REMOTE_BASE" "$HEAD_SHA" 2>/dev/null)"
  ok "线上基线：${REMOTE_BASE:0:8} → 本地 HEAD：${HEAD_SHA:0:8}"
else
  warn "服务器上没有可用的发版基线（首次走 C 方案时正常）—— 按前后端全发处理"
fi

WANT_BACKEND=0; WANT_NGINX=0
case "$MODE" in
  frontend) WANT_NGINX=1 ;;
  backend)  WANT_BACKEND=1 ;;
  all)      WANT_NGINX=1; WANT_BACKEND=1 ;;
  auto)
    if [ -z "$CHANGED" ]; then
      warn "算不出改动面 —— 保守起见按前后端全发"
      WANT_NGINX=1; WANT_BACKEND=1
    else
      printf '%s\n' "$CHANGED" | grep -qE '^backend/'                  && WANT_BACKEND=1
      printf '%s\n' "$CHANGED" | grep -qE '^(frontend/|deploy/nginx/)' && WANT_NGINX=1
      printf '%s\n' "$CHANGED" | grep -qE '^docker-compose\.yml$'      && { WANT_NGINX=1; WANT_BACKEND=1; }
    fi
    ;;
esac

if [ -n "$CHANGED" ]; then
  n="$(printf '%s\n' "$CHANGED" | wc -l)"
  echo "  改动文件（共 $n 个，最多显示 12 个）："
  printf '%s\n' "$CHANGED" | head -12 | sed 's/^/     /'
  [ "$n" -gt 12 ] && note "    ... 其余 $((n-12)) 个略"
fi

if [ "$WANT_BACKEND" -eq 0 ] && [ "$WANT_NGINX" -eq 0 ]; then
  ok "代码改动不涉及后端/前端源码 —— **本次不需要重建任何镜像**"
  note "（只改了脚本 / 文档 / 测试时就是这样，属于正常的空跑）"
  exit 0
fi

PLAN=""
[ "$WANT_BACKEND" -eq 1 ] && PLAN="$PLAN 后端"
[ "$WANT_NGINX" -eq 1 ]   && PLAN="$PLAN 前端(nginx)"
ok "本次要发：$PLAN"
note "对应服务：$([ "$WANT_BACKEND" -eq 1 ] && printf 'backend ')$([ "$WANT_NGINX" -eq 1 ] && printf 'nginx')"

# ---------------------------------------------------------------------------
# 3. 本机构建
# ---------------------------------------------------------------------------
step "3/7 本机编译"

if [ "$DRY" -eq 1 ]; then
  [ "$WANT_BACKEND" -eq 1 ] && note "[dry-run] cd backend && mvn -B -DskipTests package"
  [ "$WANT_NGINX" -eq 1 ]   && note "[dry-run] cd frontend && npm run build"
elif [ "$SKIP_BUILD" -eq 1 ]; then
  warn "--reuse-build：跳过编译，直接复用现有产物"
  if [ "$WANT_BACKEND" -eq 1 ] && [ ! -f "$BACKEND_JAR" ]; then die "没有可复用的 jar：$BACKEND_JAR"; fi
  if [ "$WANT_NGINX" -eq 1 ] && [ ! -f "$FRONTEND_DIST/index.html" ]; then die "没有可复用的 dist：$FRONTEND_DIST"; fi
else
  if [ "$WANT_BACKEND" -eq 1 ]; then
    printf '\n  %s── 后端：mvn package ──%s\n' "$C_B" "$C_0"
    _t0=$(date +%s)
    # ⚠️ 本机若有 java 进程在跑这个 jar，Maven repackage 会 "Unable to rename" 失败 ——
    #    先停掉本机 8080 再发版（脚本会提示，但不替你杀进程，避免误杀你正在用的实例）
    if ! (cd "$ROOT_DIR/backend" && JAVA_HOME="${JAVA_HOME:-C:\\Program Files\\Java\\jdk-21}" \
            "$MAVEN_BIN" -B -DskipTests package 2>&1 | tail -6); then
      die "后端构建失败 —— 若日志含 Unable to rename，说明本机有 java 正在运行该 jar：先停掉 8080 再重试"
    fi
    [ -f "$BACKEND_JAR" ] || die "构建结束但没找到 jar：$BACKEND_JAR"
    ok "后端构建完成（耗时 $(( $(date +%s) - _t0 ))s，jar $(du -h "$BACKEND_JAR" | cut -f1)）"
  fi

  if [ "$WANT_NGINX" -eq 1 ]; then
    printf '\n  %s── 前端：npm run build ──%s\n' "$C_B" "$C_0"
    _t0=$(date +%s)
    if ! (cd "$ROOT_DIR/frontend" && npm run build 2>&1 | tail -3); then
      die "前端构建失败（完整输出重跑一次 npm run build 看）"
    fi
    [ -f "$FRONTEND_DIST/index.html" ] || die "构建结束但没找到 $FRONTEND_DIST/index.html"
    ok "前端构建完成（耗时 $(( $(date +%s) - _t0 ))s，产物 $(du -sh "$FRONTEND_DIST" | cut -f1)）"
  fi

  # 产物指纹：前端 bundle 哈希 —— 后面用它证明「线上真的换成了这一版」
  LOCAL_BUNDLE="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$FRONTEND_DIST/index.html" 2>/dev/null | head -1)"
  [ -n "$LOCAL_BUNDLE" ] && note "前端入口 bundle：$LOCAL_BUNDLE"
fi

# ---------------------------------------------------------------------------
# 4. 代码同步（先让服务器拿到新 Dockerfile，再推产物）
# ---------------------------------------------------------------------------
step "4/7 同步代码到服务器"

if [ "$DRY" -eq 1 ]; then
  note "[dry-run] git push origin master（GitHub 不可达时自动回退到 git bundle 直传）"
  note "[dry-run] ssh $DEPLOY_USER@$DEPLOY_HOST 'cd $DEPLOY_DIR && git pull --ff-only …'"
elif [ "$DO_PUSH" -eq 0 ]; then
  warn "--no-push：跳过代码同步"
  note "⚠️ 本次**改过 Dockerfile / compose / nginx 配置**的话，服务器上还是旧版，构建结果可能不符预期"
else
  USED_BUNDLE=0

  if [ "$FORCE_BUNDLE" -eq 1 ]; then
    note "--bundle：跳过 GitHub，直接用 git bundle 直传"
    USED_BUNDLE=1
  else
    PUSH_OUT="$(git push origin master 2>&1)"; PUSH_RC=$?
    printf '%s\n' "$PUSH_OUT" | tail -3 | sed 's/^/     /'
    if [ "$PUSH_RC" -ne 0 ]; then
      warn "git push 失败（本机访问 github.com 被墙，或 Clash 代理未开）"
      warn "→ 自动回退到 git bundle 直传：不经过 GitHub，走 SSH 把增量提交送到服务器"
      USED_BUNDLE=1
    else
      # 退出码 0 也不可信（历史上出现过「打印 Everything up-to-date、其实没推上去」），
      # 所以照旧核验远端 sha
      REMOTE_SHA="$(R "cd $DEPLOY_DIR && git fetch -q origin master && git rev-parse origin/master" 2>/dev/null | tail -1)"
      if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then
        warn "GitHub 上最新提交是 ${REMOTE_SHA:0:8}、本地是 ${HEAD_SHA:0:8} —— push 可能没真成功，改走 bundle"
        USED_BUNDLE=1
      fi
    fi
  fi

  if [ "$USED_BUNDLE" -eq 1 ]; then
    # ---- 旁路：git bundle 增量直传（服务器能访问 GitHub 也无所谓，这条路更可靠）----
    SERVER_SHA="$(R "cd $DEPLOY_DIR && git rev-parse HEAD" 2>/dev/null | tail -1)"
    note "服务器当前 HEAD：${SERVER_SHA:0:8}    本地 HEAD：$(printf '%s' "$HEAD_SHA" | cut -c1-8)"

    BUNDLE="$ROOT_DIR/.git/yumu-deploy.bundle"   # 放 .git 里，天然不会被提交
    rm -f "$BUNDLE"
    if [ -n "$SERVER_SHA" ] && git cat-file -e "${SERVER_SHA}^{commit}" 2>/dev/null; then
      note "打包增量对象：${SERVER_SHA:0:8}..master"
      git bundle create "$BUNDLE" "${SERVER_SHA}..master" 2>&1 | tail -2 | sed 's/^/     /' \
        || die "git bundle 打包失败"
    else
      warn "服务器上的提交 ${SERVER_SHA:0:8} 不在本机仓库里（历史被重写？）→ 打包完整分支"
      git bundle create "$BUNDLE" master 2>&1 | tail -2 | sed 's/^/     /' \
        || die "git bundle 打包失败"
    fi
    [ -f "$BUNDLE" ] || die "bundle 没生成出来：$BUNDLE"
    note "bundle 体积：$(du -h "$BUNDLE" | cut -f1)"

    scp "${SCP_OPTS[@]}" -q "$BUNDLE" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/yumu-deploy.bundle" \
      || die "bundle 传输失败"
    PULL_OUT="$(R "cd $DEPLOY_DIR && git pull --ff-only /tmp/yumu-deploy.bundle master 2>&1; rm -f /tmp/yumu-deploy.bundle" 2>&1)"
    printf '%s\n' "$PULL_OUT" | tail -5 | sed 's/^/     /'
    rm -f "$BUNDLE"
  else
    R "cd $DEPLOY_DIR && git pull --ff-only origin master 2>&1 | tail -4"
  fi

  # 同步结果复核：只看退出码不够，必须比对 sha
  DEPLOYED_SHA="$(R "cd $DEPLOY_DIR && git rev-parse HEAD" 2>/dev/null | tail -1)"
  if [ "$DEPLOYED_SHA" = "$HEAD_SHA" ]; then
    if [ "$USED_BUNDLE" -eq 1 ]; then
      ok "服务器代码已同步到 $(printf '%s' "$HEAD_SHA" | cut -c1-8)（bundle 直传）"
      [ "$FORCE_BUNDLE" -eq 0 ] && note "ⓘ GitHub 上的仓库仍停在旧提交 —— Clash 开起来后补一次 git push origin master 即可"
    else
      ok "服务器代码已同步到 $(printf '%s' "$HEAD_SHA" | cut -c1-8)"
    fi
  else
    die "服务器代码没同步到 $(printf '%s' "$HEAD_SHA" | cut -c1-8)（当前 ${DEPLOYED_SHA:-未知}）——
       常见原因：服务器上有手改的已跟踪文件挡住了 --ff-only。上去看：cd $DEPLOY_DIR && git status"
  fi
fi

# ---------------------------------------------------------------------------
# 5. 推产物
# ---------------------------------------------------------------------------
step "5/7 推送构建产物"

if [ "$DRY" -eq 1 ]; then
  [ "$WANT_BACKEND" -eq 1 ] && note "[dry-run] scp $BACKEND_JAR → $DEPLOY_DIR/backend/target/"
  [ "$WANT_NGINX" -eq 1 ]   && note "[dry-run] tar czf - frontend/dist | ssh … 解到 $DEPLOY_DIR/frontend/"
else
  R "mkdir -p $DEPLOY_DIR/backend/target $DEPLOY_DIR/frontend" >/dev/null 2>&1

  if [ "$WANT_BACKEND" -eq 1 ]; then
    _t0=$(date +%s)
    SZ_LOCAL="$(wc -c < "$BACKEND_JAR" | tr -d ' ')"
    scp "${SCP_OPTS[@]}" -q "$BACKEND_JAR" "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_DIR/backend/target/$JAR_NAME.new" \
      || die "scp 传输 jar 失败"
    SZ_REMOTE="$(R "stat -c %s $DEPLOY_DIR/backend/target/$JAR_NAME.new" 2>/dev/null | tail -1)"
    [ "$SZ_LOCAL" = "$SZ_REMOTE" ] || die "jar 传输不完整（本地 $SZ_LOCAL 字节 / 远端 ${SZ_REMOTE:-0} 字节）"
    R "mv $DEPLOY_DIR/backend/target/$JAR_NAME.new $DEPLOY_DIR/backend/target/$JAR_NAME" >/dev/null 2>&1
    ok "jar 已送达并校验字节数一致（$(( $(date +%s) - _t0 ))s / $(( SZ_LOCAL / 1048576 ))MB）"
  fi

  if [ "$WANT_NGINX" -eq 1 ]; then
    _t0=$(date +%s)
    # 先把旧 dist 挪到 dist.prev（保留一份可回滚），再原地解包 —— 避免旧哈希资源残留。
    # ⚠️ 别用 `[ -d dist ] && mv …`：首次发版没有 dist 时它返回 1，会撞上远端的 set -e 直接退出。
    tar -czf - -C "$ROOT_DIR/frontend" dist \
      | R "set -e; cd $DEPLOY_DIR/frontend; if [ -d dist ]; then rm -rf dist.prev; mv dist dist.prev; fi; tar -xzf -; test -f dist/index.html && echo UNPACK_OK" \
      | tail -2 | grep -q UNPACK_OK || die "dist 传输/解包失败"
    REMOTE_BUNDLE="$(R "grep -o 'assets/index-[A-Za-z0-9_-]*\.js' $DEPLOY_DIR/frontend/dist/index.html 2>/dev/null" | head -1)"
    if [ -n "$LOCAL_BUNDLE" ] && [ "$REMOTE_BUNDLE" != "$LOCAL_BUNDLE" ]; then
      die "服务器上的前端产物哈希（${REMOTE_BUNDLE:-空}）与本地（$LOCAL_BUNDLE）不一致 —— 传输有问题"
    fi
    ok "前端 dist 已送达并校验 bundle 一致（$(( $(date +%s) - _t0 ))s / $REMOTE_BUNDLE）"
  fi
fi

# ---------------------------------------------------------------------------
# 6. 服务器组装上线（Dockerfile 已是纯 COPY，秒级完成）
# ---------------------------------------------------------------------------
step "6/7 服务器组装镜像并上线"

SCOPE_ARGS=""
case "$MODE" in
  frontend) SCOPE_ARGS="frontend" ;;
  backend)  SCOPE_ARGS="backend" ;;
  all)      SCOPE_ARGS="all" ;;
  auto)     SCOPE_ARGS="" ;;
esac
[ "$DRY" -eq 1 ] && SCOPE_ARGS="$SCOPE_ARGS --dry-run"

note "在服务器执行：bash deploy/tools/release.sh $SCOPE_ARGS --no-pull"
note "（--no-pull 是因为第 4 步已经同步过代码；--no-pull 与 --dry-run 互不影响）"
echo

R "cd $DEPLOY_DIR && bash deploy/tools/release.sh $SCOPE_ARGS --no-pull"
RC=$?
if [ "$RC" -ne 0 ]; then
  die "服务器端上线失败（release.sh 退出码 $RC）—— 上面就是它在哪一步失败的"
fi
ok "服务器端上线完成"

# ---------------------------------------------------------------------------
# 7. 本机外部验收（不依赖服务器自检，从外面再看一眼）
# ---------------------------------------------------------------------------
step "7/7 上线验收（从本机外部探测）"

if [ "$DRY" -eq 1 ]; then
  note "[dry-run] 跳过验收"
  printf '\n%s🧪 dry-run 结束：只打印了计划，没有编译、没有推送、没有动任何容器。%s\n' "$C_Y" "$C_0"
  exit 0
fi

sleep 3
FAIL=0

# 7.1 首页真 SPA（不是静态 404 页）
HTML="$(curl -s -m 15 "$BASE_URL/" || echo '')"
if printf '%s' "$HTML" | grep -q 'assets/index-'; then
  REMOTE_BUNDLE="$(printf '%s' "$HTML" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)"
  if [ -n "$LOCAL_BUNDLE" ] && [ "$REMOTE_BUNDLE" != "$LOCAL_BUNDLE" ]; then
    warn "首页引用的 bundle 仍是 $REMOTE_BUNDLE（本地构建的是 $LOCAL_BUNDLE）—— 前端可能没换新"
    FAIL=1
  else
    ok "首页是真 SPA 且 bundle 与本次构建一致（$REMOTE_BUNDLE）"
  fi
else
  err "首页内容不像真实 SPA（长度 $(printf '%s' "$HTML" | wc -c) 字节）"
  FAIL=1
fi

# 7.2 五项安全响应头（判「是不是本项目的 nginx 在应答」）
HDRS="$(curl -sI -m 15 "$BASE_URL/" || echo '')"
MISS=""
for h in x-content-type-options x-frame-options referrer-policy permissions-policy content-security-policy; do
  printf '%s' "$HDRS" | grep -qi "^$h:" || MISS="$MISS $h"
done
if [ -z "$MISS" ]; then
  ok "五项安全响应头齐全（应答者确实是本项目的 nginx）"
else
  err "安全响应头缺失：$MISS —— 应答者很可能是宝塔自带的 nginx，不是本项目容器"
  FAIL=1
fi

# 7.3 后端 API 健康
H="$(curl -s -m 20 "$BASE_URL/api/actuator/health" || echo '')"
if printf '%s' "$H" | grep -q '"UP"'; then
  ok "后端 API 健康：$H"
else
  err "后端健康检查异常：${H:-（无响应）}"
  FAIL=1
fi

# 7.4 真实业务接口（比 health 更能说明问题）
B="$(curl -s -m 20 "$BASE_URL/api/boards" | head -c 200)"
if [ "$(printf '%s' "$B" | wc -c)" -gt 20 ]; then
  ok "业务接口 /api/boards 有真实返回"
else
  warn "/api/boards 返回内容偏少 —— 手动开一次页面确认"
fi

DUR=$(( $(date +%s) - T0 ))
echo
if [ "$FAIL" -eq 0 ]; then
  printf '%s✅ 发版成功！访问：%s/   （域名未备案期间用 IP）%s\n' "$C_G" "$BASE_URL" "$C_0"
  printf '%s   已上线提交：%s   全程耗时：%ss%s\n' "$C_D" "$(git rev-parse --short=8 HEAD)" "$DUR" "$C_0"
  exit 0
else
  printf '%s⚠️  发版流程走完了，但外部验收有未通过项（见上面 ❌/⚠️）—— 请人工确认。%s\n' "$C_Y" "$C_0"
  printf '%s   已上线提交：%s   全程耗时：%ss%s\n' "$C_D" "$(git rev-parse --short=8 HEAD)" "$DUR" "$C_0"
  exit 1
fi
