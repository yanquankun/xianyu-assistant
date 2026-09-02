#!/usr/bin/env bash

set -euo pipefail

echo '  检查 GitHub CLI 本地凭据……'
if ! gh auth token --hostname github.com >/dev/null 2>&1; then
  echo '发布失败：GitHub CLI 尚未登录，请先执行 gh auth login。' >&2
  exit 1
fi
echo '  GitHub CLI 登录检查通过。'
