# B1 · Nginx 反代 + HTTPS（Let's Encrypt）操作手册

本目录提供两种使用方式：
1. **Docker 一体化**（推荐，配合根目录 docker-compose.yml）：`deploy/nginx/Dockerfile` 会先构建前端再打入 nginx 镜像。
2. **宿主机裸 Nginx**：把 `yumu.conf`（HTTP）或 `yumu-https.conf.example`（HTTPS）拷到 `/etc/nginx/conf.d/yumu.conf`，`upstream backend:8080` 改成 `127.0.0.1:8080`。

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

- [ ] 80 端口只 301 到 https（HTTPS 版已内置）
- [ ] `curl -I https://域名` 返回 200 且协议为 https
- [ ] 后端 8080 / MySQL 3306 / Redis 6379 **未对公网暴露**（compose 默认不映射，云安全组也确认关掉）
- [ ] `https://域名/api/system/cache-mode` 正常返回（Redis 建议生产开启）
