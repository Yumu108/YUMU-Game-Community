#!/usr/bin/env python3
"""打包课程作业交付 zip：backend/ + miniprogram/ + 交付说明.md。

用法：
    python tools/pack-delivery.py                 # 输出到仓库上一级目录
    python tools/pack-delivery.py -o D:/xx.zip    # 指定输出

为什么要写成脚本：这活儿每次都靠手工挑文件，**极易混进垃圾**。
2026-09-26 手工打了两次都出错：
  ① 第一次把 `backend/run*.log`（19 个）+ `backend/logs/`（15 个）打了进去；
  ② 第二次把 `miniprogram/dist_bak_h5.*`（4 个备份目录，各含 246KB 的 index js）
     和 `miniprogram/tests/shots/`（47 张回归截图）打了进去 —— 包体从 1.5MB 涨到 5.1MB。
两个坑都属于「肉眼看不出来」：目录太多，没人会逐个核对。

⚠️ `dist_bak_h5.*` 的来源：本机发版脚本在 `frontend/dist` 批量删除守卫触发时，
会把 dist 改名挪走再重试（见 deploy-local.sh），小程序侧同理留下备份目录。
⇒ **每次发版后都会新增这类目录**，所以必须靠规则排除，不能靠人记。
"""
import argparse
import os
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 目录名精确匹配即跳过（出现在路径任意一层都会被拦掉）
DIR_SKIP = {
    ".git",
    "node_modules",
    "target",       # backend/target（jar 产物）
    "uploads",      # backend/uploads（运行期上传的二进制）
    "logs",         # backend/logs
    "h5",           # miniprogram/dist/build/h5（可本地重建，体积大）
    "shots",        # miniprogram/tests/shots（回归截图，非交付物）
    ".pw",          # tests/.pw（playwright，~百 MB）
    ".workbuddy",   # 项目内部记忆，不对外
    "out",          # db-seed/out（被 gitignore）
    "__pycache__",
    ".pytest_cache",
}

# 目录名前缀匹配（发版产生的备份目录）
DIR_SKIP_PREFIX = ("dist_bak", "dist.bak.")

FILE_SKIP_SUFFIX = (".zip", ".log", ".pyc")

FILE_SKIP_EXACT = {".env.local", ".DS_Store"}  # .env.local 含个人 AppID

# 顶层要收进包里的目录（其余一律不要 —— 例如 frontend/ 主站前端不在本作业范围内）
TOP_DIRS = ("backend", "miniprogram")

# 交付说明以什么名字放进包根
DOC_SRC = os.path.join(os.path.dirname(REPO), "YUMU小程序交付说明.md")
DOC_ARC = "交付说明.md"


def keep(rel_path: str) -> bool:
    """rel_path 是相对 TOP_DIRS 某一项的路径（用 / 分隔）。"""
    parts = rel_path.replace("\\", "/").split("/")
    for p in parts[:-1]:
        if p in DIR_SKIP or p.startswith(DIR_SKIP_PREFIX):
            return False
    name = parts[-1]
    if name in FILE_SKIP_EXACT or name.endswith(FILE_SKIP_SUFFIX):
        return False
    return True


def add_tree(zf: zipfile.ZipFile, src_dir: str, arc_prefix: str) -> int:
    count = 0
    for base, dirs, files in os.walk(src_dir):
        dirs[:] = sorted(
            d for d in dirs if d not in DIR_SKIP and not d.startswith(DIR_SKIP_PREFIX)
        )
        for f in sorted(files):
            full = os.path.join(base, f)
            rel = os.path.relpath(full, src_dir)
            if not keep(rel):
                continue
            zf.write(full, f"{arc_prefix}/{rel.replace(os.sep, '/')}")
            count += 1
    return count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "-o",
        "--out",
        default=os.path.join(os.path.dirname(REPO), "YUMU作业_后端+小程序.zip"),
        help="输出 zip 路径",
    )
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    tmp = out + ".tmp"

    if not os.path.isdir(os.path.join(REPO, "backend")):
        print("✗ 找不到 backend/，脚本必须放在仓库的 tools/ 下", file=sys.stderr)
        return 1

    for p in (tmp,):
        if os.path.exists(p):
            os.remove(p)

    stats = {}
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for top in TOP_DIRS:
            d = os.path.join(REPO, top)
            if os.path.isdir(d):
                stats[top] = add_tree(zf, d, top)
        if os.path.exists(DOC_SRC):
            zf.write(DOC_SRC, DOC_ARC)
            stats[DOC_ARC] = 1
        else:
            # 说明文档不在仓库里（在主目录），缺了就明确提示，别静默少一个文件
            print(f"⚠️ 未找到交付说明：{DOC_SRC}（包里将不带 {DOC_ARC}）")

    if os.path.exists(out):
        os.remove(out)
    os.rename(tmp, out)

    total = sum(stats.values())
    size_mb = os.path.getsize(out) / 1024 / 1024
    for k, v in stats.items():
        print(f"  {k:15s} {v:5d} 个文件")
    print(f"✅ 生成 {out}")
    print(f"   共 {total} 个条目 / {size_mb:.2f} MB")

    # 自检：确认没有任何被禁的东西漏进去（防规则写错）
    with zipfile.ZipFile(out) as zf:
        bad = [
            n
            for n in zf.namelist()
            if n.endswith(FILE_SKIP_SUFFIX)
            or any(seg.startswith(DIR_SKIP_PREFIX) for seg in n.split("/"))
            or "/shots/" in n
        ]
    if bad:
        print(f"❌ 自检失败，包里仍有 {len(bad)} 个应排除的条目，例如：{bad[:3]}")
        return 1
    print("   自检通过：无日志 / 无构建备份 / 无截图")
    return 0


if __name__ == "__main__":
    sys.exit(main())
