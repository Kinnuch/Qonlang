#!/usr/bin/env sh
# macOS / Linux：启动开发版（热更新）。用法：sh dev.sh
cd "$(dirname "$0")" || exit 1
unset ELECTRON_RUN_AS_NODE
if [ ! -d node_modules ]; then
  echo "首次运行，先安装依赖..."
  npm install --registry=https://registry.npmmirror.com
fi
npm run dev
