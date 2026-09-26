# -*- coding: utf-8 -*-
"""
版主举报队列「游戏级过滤」修复的端到端验证（2026-09-26）。

背景：`AdminController#listReports` 原先把 `listBoardIdsByUserId(...)` 的结果当过滤条件，
但授权模型早已是**游戏级**（moderator_board.board_id 恒 NULL）⇒ 那个方法对 board_id 列
做 distinct().sorted()，全 NULL 时得到 [null]（单元素，不抛异常），SQL 生成
`p.board_id IN (null)` **恒不命中** ⇒ 版主看到的是空队列。

本脚本做三件事：
  1. 直接对 SQL 做 A/B：老谓词（board_id IN (NULL)）对比新谓词（game_id IN (…)）
  2. 用**管理员**真实接口拉全站待处理举报，作为分母
  3. 用**版主**真实接口（重置密码后登录，拿真 token）拉队列，核对只含所辖游戏
     —— 这一步是「修复真的生效」的硬证据，不是靠读代码推断
"""
import json
import subprocess
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8080/api"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"

results = []


def ok(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("✅ " if cond else "❌ ") + name + (("\n     " + str(extra)) if extra else ""))


def sql(q):
    p = subprocess.run([MYSQL, "-uroot", "-p123456", "yumu_community", "-N", "-e", q],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (p.stdout or "").strip()


def api(path, token=None, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"code": e.code, "raw": e.read().decode()[:300]}


def login(u, p):
    d = api("/auth/login", method="POST", body={"username": u, "password": p})
    if d.get("code") != 200:
        return None
    return (d.get("data") or {}).get("token")


print("=== ① SQL 层 A/B：老谓词 vs 新谓词 ===")
OLD = """
SELECT COUNT(*) FROM report r WHERE r.deleted=0 AND r.status=0 AND (
  (r.target_type=1 AND EXISTS(SELECT 1 FROM post p WHERE p.id=r.target_id AND p.board_id IN (NULL)))
  OR (r.target_type=2 AND EXISTS(SELECT 1 FROM reply rp JOIN post p ON p.id=rp.post_id
     WHERE rp.id=r.target_id AND p.board_id IN (NULL))))
"""
NEW17 = """
SELECT COUNT(*) FROM report r WHERE r.deleted=0 AND r.status=0 AND (
  (r.target_type=1 AND EXISTS(SELECT 1 FROM post p WHERE p.id=r.target_id AND p.game_id IN (17)))
  OR (r.target_type=2 AND EXISTS(SELECT 1 FROM reply rp JOIN post p ON p.id=rp.post_id
     WHERE rp.id=r.target_id AND p.game_id IN (17))))
"""
old_cnt = sql(OLD)
new17 = sql(NEW17)
ok("老谓词（board_id IN (NULL)）匹配 0 行 —— 这就是版主队列恒为空的根因",
   old_cnt == "0", f"老谓词 {old_cnt} 行 / 新谓词(游戏17) {new17} 行")
ok("新谓词（game_id IN (17)）能匹配到举报（说明改对了维度）",
   int(new17 or 0) > 0, f"游戏 17 待处理举报 {new17} 条")

print("\n=== ② 管理员：全站队列（分母） ===")
adm = login("admin", "admin123456")
ok("管理员登录成功并拿到 token", bool(adm))
allr = api("/admin/reports?status=0&current=1&size=100", adm)
ok("GET /admin/reports 返回 code=200", allr.get("code") == 200, allr.get("message"))
recs = (allr.get("data") or {}).get("records") or []
total = (allr.get("data") or {}).get("total")
print(f"     管理员看到待处理举报 {total} 条：")
for r in recs:
    print(f"       #{r['id']} type={r['targetType']} 游戏={r.get('gameId')}"
          f"({r.get('gameName')}) 板块={r.get('boardName')} 理由={r['reason'][:14]}")
ok("全站待处理 = 7 条（与库内一致）", total == 7, f"total={total}")
ok("VO 新增了 gameId/gameName/boardName 字段（端内要显示归属）",
   any(r.get("gameId") for r in recs) and any(r.get("gameName") for r in recs),
   f"示例：{recs[0].get('gameName')} / {recs[0].get('boardName')}" if recs else "无数据")

print("\n=== ③ 版主：只看自己负责的游戏（硬证据） ===")
# user 1005 = yumu_10605，moderator_board 里负责 game_id=17
MID, MGAME = 1005, 17
assign = sql(f"SELECT game_id FROM moderator_board WHERE user_id={MID} AND deleted=0")
ok(f"版主 #{MID} 的授权游戏 = {MGAME}（读库确认，非假设）", assign == str(MGAME), f"库内 game_id={assign}")

# ⚠️ 后端 `ResetPasswordRequest.newPassword` **不能留空**（管理员显式指定，≥6 位）。
#    第一版脚本传了空 body，拿到的报错是「请输入新密码（不允许留空）」——
#    这本身也顺带验证了该防线的存在。
PROBE_PWD = "ModProbe123!"
rp = api(f"/admin/users/{MID}/reset-password", adm, "PUT", {"newPassword": PROBE_PWD})
ok("管理员重置该版主密码以取得真实登录态（仅本机验证用）",
   rp.get("code") == 200, rp.get("message"))

uname = sql(f"SELECT username FROM user WHERE id={MID}")
mod = login(uname, PROBE_PWD)
ok("版主用真实 token 登录成功（拿到库里的角色，不是注入的）", bool(mod), f"账号={uname}")

mres = api("/admin/reports?status=0&current=1&size=100", mod)
ok("版主调 GET /admin/reports 返回 code=200（不是 403）", mres.get("code") == 200, mres.get("message"))
mrecs = (mres.get("data") or {}).get("records") or []
mtotal = (mres.get("data") or {}).get("total")
games = sorted({r.get("gameId") for r in mrecs})
print("     版主看到：" + ", ".join(
    "#%s@game%s" % (r["id"], r.get("gameId")) for r in mrecs) if mrecs else "     （空）")
ok("🔑 版主能看到举报了（修复前恒为 0 条，这是本次修复的核心断言）",
   (mtotal or 0) > 0, f"修复前 0 条 → 修复后 {mtotal} 条")
ok("版主看到的**每一条**都属于自己负责的游戏（无越权）",
   games == [MGAME], f"出现过的 gameId={games}（应只有 [{MGAME}]）")
ok("版主看不到「用户举报」（type=3，仅管理员可处理）",
   all(r.get("targetType") != 3 for r in mrecs),
   f"targetType 集合={sorted({r.get('targetType') for r in mrecs})}")
ok("版主数量 < 管理员数量（作用域确实收窄了）",
   (mtotal or 0) < (total or 0), f"版主 {mtotal} / 管理员 {total}")

print("\n=== ④ 越权方向：版主不能处理别人的举报 ===")
# 找一条**不在**该版主游戏里的待处理举报
outsider = next((r for r in recs if r.get("gameId") not in (None, MGAME)), None)
if outsider:
    h = api(f"/admin/reports/{outsider['id']}/handle", mod, "POST",
            {"status": 2, "handleNote": "越权探测"})
    ok("版主处理非辖区举报 → 被后端拒绝（403）",
       h.get("code") == 403, f"code={h.get('code')} msg={h.get('message')}")
    ok("该举报未被改动（拒绝是生效的，不是静默放行）",
       sql(f"SELECT status FROM report WHERE id={outsider['id']}") == "0")
else:
    ok("越权探测", False, "未找到可用的非辖区举报")

print("\n=== ⑤ 幂等保护：重复处理已结案的举报 ===")
d2 = sql("SELECT id FROM report WHERE deleted=0 AND status<>0 LIMIT 1")
if d2:
    h = api(f"/admin/reports/{d2}/handle", adm, "POST", {"status": 2})
    ok("管理员重复处理已结案举报 → 被拒（400「该举报已处理」）",
       h.get("code") == 400, f"code={h.get('code')} msg={h.get('message')}")

print("\n=== 汇总 ===")
p = sum(1 for _, c in results if c)
print(f"通过 {p} / {len(results)}")
raise SystemExit(0 if p == len(results) else 1)
