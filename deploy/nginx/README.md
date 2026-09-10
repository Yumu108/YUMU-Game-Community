# B1 · Nginx 反代 + HTTPS（Let's Encrypt）操作手册

本目录提供两种使用方式：
1. **Docker 一体化**（推荐，配合根目录 docker-compose.yml）：`deploy/nginx/Dockerfile` 会先构建前端再打入 nginx 镜像。
2. **宿主机裸 Nginx**：把 `yumu.conf`（HTTP）或 `yumu-https.conf.example`（HTTPS）拷到 `/etc/nginx/conf.d/yumu.conf`，**并把 `security-headers.conf` 拷到 `/etc/nginx/snippets/security-headers.conf`**（配置里以该绝对路径 include，缺了会导致 `nginx -t` 直接失败），`upstream backend:8080` 改成 `127.0.0.1:8080`。

> **D5（9-10）安全响应头**：`security-headers.conf` 统一声明 X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy / CSP。
> ⚠️ **不要把它合并进 server 块就完事** —— Nginx 的 `add_header` 是「全有或全无」继承：`/assets/` 里已有 `Cache-Control`，一旦子块写了任何 `add_header`，server 级的安全头就**不再下发**。因此 server 与每个 location 都必须显式 `include`（本目录已完成）。

## 一、HTTP（默认）—— 零条件可用

```bash
docker compose up -d --build nginx
# 浏览器访问 http://服务器IP/
```

反代规则：`/api/* → backend:8080`（含 SSE 关缓冲、WS 升级头），其余走 SPA 静态回退。

## 二、HTTPS 签发（需要：一个域名 + 80 端口可达 + 服务器在国内境外均可）

```bash
# 1) 安装 certbot（宿主机）
sudo apt install certbot        # Debian/Ubuntu
# sudo yum install certbot      # CentOS

# 2) 先起 HTTP 版 nginx，保证 http://你的域名/.well-known/ 可访问
docker compose up -d nginx

# 3) webroot 方式签发（不中断服务）
sudo certbot certonly --webroot -w /var/www/certbot -d 你的域名

# 4) 启用 HTTPS 配置
cp deploy/nginx/yumu-https.conf.example deploy/nginx/yumu-https.conf
#    把文件里 4 处 your-domain.com 全部替换成你的域名
#    docker-compose.yml 的 nginx 服务追加卷挂载（见 compose 内注释）：
#      - /etc/letsencrypt:/etc/letsencrypt:ro
#      - /var/www/certbot:/var/www/certbot
#    并把 Dockerfile 里 COPY 的 conf 换成 yumu-https.conf（或直接改 yumu.conf 内容）

# 5) 重载
docker compose up -d --force-recreate nginx
curl -I https://你的域名
```

## 三、证书续期（90 天有效期，自动续）

宿主机 crontab：
```
0 4 * * 1 certbot renew --quiet --deploy-hook "docker restart yumu-nginx"
```

## 四、安全基线自查（上线前过一遍）

- [ ] **配置语法**：`nginx -t` 通过（容器方式：`docker compose exec nginx nginx -t`）
- [ ] 80 端口只 301 到 https（HTTPS 版已内置）
- [ ] `curl -I https://域名` 返回 200 且协议为 https
- [ ] **D5 安全头齐全**：响应头含 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`、`Content-Security-Policy`；HTTPS 下还应有 `Strict-Transport-Security`
  - 抽查要针对**多个路径**（`/` 与 `/assets/xxx.js`），因为 location 上的 `add_header` 会覆盖 server 级 —— 只看首页会漏掉静态资源的头
- [ ] **不暴露版本号**：`curl -I` 的 `Server` 头里不应出现 `nginx/1.27.x` 这类具体版本（`server_tokens off` 生效）
- [ ] **CSP 未误伤**：浏览器控制台无 `Refused to ... Content Security Policy` 报错；帖子/游戏外链封面能正常显示（`img-src` 已放行 `https:`）
- [ ] 后端 8080 / MySQL 3306 / Redis 6379 **未对公网暴露**（compose 默认不映射，云安全组也确认关掉）
- [ ] `https://域名/api/system/cache-mode` 正常返回（Redis 建议生产开启）
