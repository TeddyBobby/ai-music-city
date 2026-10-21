#!/bin/zsh
# 在本目录启动已安装的 AI乐之城；不下载模型、不启动模拟引擎。
emulate -LR zsh
setopt NO_UNSET PIPE_FAIL

launcher_dir="${0:A:h}"
studio_dir="${launcher_dir:h:h}"
studio_bin="$studio_dir/.venv/bin/yue2-studio"
studio_python="$studio_dir/.venv/bin/python"
studio_url='http://127.0.0.1:8765/'

fail() {
  print -u2 -r -- "$1"
  if [[ -t 0 ]]; then
    read -r 'REPLY?按回车关闭窗口……' || true
  fi
  exit 1
}

[[ -d "$studio_dir" ]] || fail "找不到项目目录：$studio_dir"
[[ -x "$studio_bin" && -x "$studio_python" ]] || fail '安装尚未完成：找不到 AI乐之城 虚拟环境。'
cd -- "$studio_dir" || fail "无法进入项目目录：$studio_dir"

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export YUE2_STUDIO_HOME="$studio_dir"
export MLX_ENABLE_TF32=0
export HF_HUB_OFFLINE=1
unset YUE2_STUDIO_FAKE YUE2_STUDIO_FAKE_DELAY

# 仅复用本目录的真实引擎；其他服务占用端口时退出，不结束任何进程。
"$studio_python" - "$studio_dir" <<'PY'
import json
import socket
import sys
import urllib.request
from pathlib import Path

root = Path(sys.argv[1]).resolve()
try:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", 8765))
except OSError:
    try:
        # 本机请求不经过系统 HTTP 代理。
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:8765/api/status", timeout=3) as response:
            if response.status != 200:
                raise ValueError("unexpected status")
            payload = json.loads(response.read(1024 * 1024))
        models = payload.get("models", {})
        engine = payload.get("engine", {})
        matches = (
            payload.get("fake") is False
            and isinstance(payload.get("version"), str)
            and isinstance(engine, dict)
            and isinstance(engine.get("state"), str)
            and "current_job_id" in engine
            and Path(models.get("converted_dir", "")).resolve() == root / "models" / "converted"
            and Path(models.get("vae_dir", "")).resolve() == root / "models" / "vae"
        )
        if not matches:
            raise ValueError("different service or project")
    except Exception:
        print("端口 8765 已被占用，且未确认是本目录的真实 AI乐之城。请先检查占用程序。", file=sys.stderr)
        sys.exit(2)
    sys.exit(0)
else:
    # 端口可用；关闭探测 socket 后由服务器正常监听。
    sys.exit(10)
PY
probe_result=$?

# 验证音乐端口后，启动或复用本工作台专用助手；助手不可用不阻止本地音乐。
if [[ "$probe_result" == 0 || "$probe_result" == 10 ]]; then
  "$studio_python" -m yue2_studio.hermes_control start --home "$studio_dir" || true
fi

case "$probe_result" in
  0)
    print -r -- 'AI乐之城 已在运行，正在打开页面。'
    /usr/bin/open "$studio_url" || fail "请手动打开：$studio_url"
    exit 0
    ;;
  10)
    print -r -- '正在启动 AI乐之城……'
    print -r -- "浏览器地址：$studio_url"
    print -r -- '使用期间请保留这个终端窗口；Control-C 停止音乐服务。'
    print -r -- '助手在后台独立运行；双击同目录“停止助手.command”可停止。'
    exec "$studio_python" -m yue2_studio.main --host 127.0.0.1 --port 8765 --open
    ;;
  *)
    fail '启动已停止，未修改或关闭其他服务。'
    ;;
esac
