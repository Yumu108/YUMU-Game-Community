# B5：基础日志 / 监控 / 告警

> 目标：服务出问题时**你先知道**，而不是等用户来投诉。
> 三件事：**日志能查**（落盘+轮转）→ **状态可探**（health 端点）→ **异常会叫**（webhook 告警）。

---

## 一、这套东西由什么组成

| 位置 | 作用 |
|------|------|
| `backend/src/main/resources/logback-spring.xml` | 日志落盘：`yumu-community.log` 全量 + `yumu-community-error.log` 仅错误；按天切分、单文件 100MB 封顶、保留 30 天 |
| `backend/src/main/resources/application.yml` | `logging.*` 与 `management.*` 配置：只暴露 `health`/`info`，`show-details=never` |
| `SecurityConfig` | `/actuator/health` 放行，其余 actuator 端点一律不放行 |
| `docker-compose.yml` | backend 健康检查改打 `/api/actuator/health`；日志挂到宿主机 `./logs`；四服务统一 `json-file` 轮转 10m×3 |
| `deploy/monitor/health-check.sh` | 探活脚本：HTTP + 端口 + 磁盘，连续 3 次失败才告警，恢复补发通知 |
| `deploy/monitor/notify.sh` | 统一告警出口：企业微信 / 钉钉 / Server酱 webhook |

---

## 二、日志在哪看

```bash
# 容器部署（compose 已挂 ./logs:/app/logs）
tail -f logs/yumu-community.log          # 全量
tail -f logs/yumu-community-error.log    # 只看错误，排查首选
grep -n "限频\|风控" logs/yumu-community.log   # 查 A2 限频 / C1 风控命中情况

# 单容器实时日志
docker compose logs -f --tail 200 backend
```

日志目录由环境变量 `LOG_DIR` 控制（默认 `./logs`，容器里是 `/app/logs`）。

---

## 三、健康检查端点

```bash
curl http://127.0.0.1/api/actuator/health
# → {"status":"UP"}
```

- **只返回 `UP`/`DOWN`**，不暴露数据库连接串、Redis 细节（`show-details=never`）。
- Redis 被刻意从健康指示器里关掉了：它是降级组件，Redis 挂了应用仍应算健康。
- ⚠️ **绝不要**把 `env` / `heapdump` / `beans` / `configprops` 加进 `management.endpoints.web.exposure.include` ——那些端点会把 `JWT_SECRET`、数据库密码明文吐出来，直接废掉 B4 密钥外置。

---

## 四、配置告警通道（3 选 1）

在 `.env` 里加两行：

```bash
ALERT_WEBHOOK_TYPE=wechat        # wechat | dingtalk | serverchan
ALERT_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx
```

| 通道 | 怎么拿 URL |
|------|-----------|
| 企业微信群机器人（推荐） | 群设置 → 群机器人 → 添加 → 复制 Webhook 地址 |
| 钉钉群机器人 | 群设置 → 智能群助手 → 添加机器人 → 自定义 → 复制 Webhook（安全设置选「自定义关键词」，关键词填 `YUMU`） |
| Server酱 | https://sct.ftqq.com 登录 → 复制 SendKey，URL 填 `https://sctapi.ftqq.com/<SendKey>.send` |

**没配 webhook 也能先跑**：脚本会降级为本地日志（`deploy/monitor/.state` 同级目录），不阻断主流程。

### 验证通道是否配通

```bash
cd deploy/monitor
./health-check.sh --force-alert      # 手机/群里收到「YUMU 监控自检（测试）」即成功
```

---

## 五、挂 crontab（每 5 分钟探活）

```bash
crontab -e
```

```cron
# YUMU 服务探活：每 5 分钟一次
# ⚠️ 先 source .env 取 DB_PASSWORD / ALERT_WEBHOOK_URL；再显式指定 CHECK_URL / CHECK_PORT（见下方说明）
*/5 * * * * cd /opt/yumu && set -a && . ./.env && set +a && CHECK_URL='http://127.0.0.1/api/actuator/health' CHECK_PORT=80 ./deploy/monitor/health-check.sh >> /var/log/yumu-health-cron.log 2>&1

# MySQL 每日备份：每天凌晨 3 点（失败会自动告警，见下）
0 3 * * * cd /opt/yumu && set -a && . ./.env && set +a && ./deploy/backup/db-backup.sh >> /var/log/yumu-backup-cron.log 2>&1
```

> ⚠️ **为什么要 `source .env`？** crontab 不继承你的 shell 环境，`db-backup.sh` 拿不到 `DB_PASSWORD`
> 脚本会立即报错退出（`DB_PASSWORD` 现为必填，仓库不设弱口令兜底）→ 备份失败并告警；`notify.sh` 也拿不到 `ALERT_WEBHOOK_URL` → 告警发不出去
> （降级为写本地日志）。所以 cron 里必须先把 `.env` 载进来。

> ⚠️ **`CHECK_URL` / `CHECK_PORT` 为什么要显式写？**
> 脚本默认探的是 `http://127.0.0.1:8080/api/actuator/health`（本机直接跑 jar 的场景）。
> 但 **compose 部署时 backend 的 8080 没有映射到宿主机**（只在内网 `backend:8080`，这是刻意的安全设计），
> 宿主机上 8080 根本连不通 → 探活会**永远失败**，连续 3 次后开始无脑告警。
> 因此容器部署一律改成从 **Nginx 入口**探：`CHECK_URL=http://127.0.0.1/api/actuator/health`、`CHECK_PORT=80`。
> 顺带这还多验证了一层「Nginx 反代是否正常」，比只探后端更有意义。

---

## 六、告警长什么样

**服务异常**

```
【YUMU 服务异常（连续 3 次探活失败）】
时间：2026-09-09 03:15:00
主机：yumu-prod-01
HTTP 健康检查失败：curl 退出码 7；端口 127.0.0.1:8080 不可连接

容器状态：
SERVICE   STATUS
backend   Up 2 minutes (unhealthy)
mysql     Up 3 hours (healthy)

最近错误日志：
2026-09-09 03:14:58 ERROR [http-nio-8080-exec-9] c.y.c.s.TokenBlacklistService - Redis 不可用，回退本地黑名单
```

**服务恢复**：同一通道补发一条「YUMU 服务已恢复」，恢复前不再重复刷屏。

**磁盘不足**：剩余可用低于 10% 触发一次，恢复后自动解除。

---

## 七、状态文件与清理

`deploy/monitor` 执行后会在项目根目录生成 `.monitor-state/`：

| 文件 | 含义 |
|------|------|
| `fail.count` | 当前连续失败次数 |
| `alerted.flag` | 存在 = 处于告警态（删掉它会让下一次失败重新告警） |
| `disk.flag` | 磁盘告警已发出 |
| `health-check.log` | 每次探活的执行记录 |

建议加进 `.gitignore`（见根目录配置）。想手动复位：`rm -rf .monitor-state`。

---

## 八、上线后建议补的两步（非必须）

1. **外部探活**：再挂一个 UptimeRobot / 阿里云云监控，从外网探一次，能发现"容器在但 Nginx 挂了"这类内网探活盲区。
2. **备份恢复演练**：每月在测试机跑一次 `deploy/backup/db-restore.sh`，确认 dump 真的能恢复（只备份不演练 = 没备份，见 `备份与恢复演练.md`）。
