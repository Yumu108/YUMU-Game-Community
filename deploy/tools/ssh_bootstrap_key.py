#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
首次给部署服务器安装本机 SSH 公钥（之后所有发布/运维操作即可免密）。

用法（密码只走环境变量，不落盘、不写进任何文件）：
    SSH_HOST=8.133.255.202 SSH_USER=root SSH_PASSWORD=xxxx \
      python deploy/tools/ssh_bootstrap_key.py

幂等：公钥已存在则跳过，不会重复追加。
依赖：pip install paramiko
"""
import os
import sys
import pathlib

import paramiko

HOST = os.environ.get("SSH_HOST", "8.133.255.202")
USER = os.environ.get("SSH_USER", "root")
PASSWORD = os.environ.get("SSH_PASSWORD")
PORT = int(os.environ.get("SSH_PORT", "22"))
PUBKEY = pathlib.Path(os.environ.get("SSH_PUBKEY", pathlib.Path.home() / ".ssh" / "id_ed25519.pub"))

if not PASSWORD:
    sys.exit("缺少 SSH_PASSWORD 环境变量")


def main():
    if not PUBKEY.exists():
        sys.exit(f"公钥不存在：{PUBKEY}")
    pub = PUBKEY.read_text(encoding="utf-8").strip()

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)

    cmd = (
        'mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && '
        'chmod 600 ~/.ssh/authorized_keys && '
        f'grep -qF "{pub}" ~/.ssh/authorized_keys && echo ALREADY || '
        f'(echo "{pub}" >> ~/.ssh/authorized_keys && echo INSTALLED)'
    )
    _, out, err = cli.exec_command(cmd, timeout=30)
    result = out.read().decode(errors="replace").strip()
    errtext = err.read().decode(errors="replace").strip()
    print(f"[{HOST}] 公钥状态：{result}")
    if errtext:
        print("stderr:", errtext)
    cli.close()
    print("完成。现在可免密登录：", f"ssh {USER}@{HOST}")


if __name__ == "__main__":
    main()
