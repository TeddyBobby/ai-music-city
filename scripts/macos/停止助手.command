#!/bin/zsh
emulate -LR zsh
setopt NO_UNSET PIPE_FAIL
launcher_dir="${0:A:h}"
studio_dir="${launcher_dir:h:h}"
cd -- "$studio_dir" || exit 1
"$studio_dir/.venv/bin/python" -m yue2_studio.hermes_control stop --home "$studio_dir"
if [[ -t 0 ]]; then
  read -r 'REPLY?按回车关闭窗口……' || true
fi
