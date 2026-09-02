#!/usr/bin/env bash

set -euo pipefail

if [[ ! -t 0 || ! -t 1 ]]; then
  echo '发布脚本必须在交互式终端中运行。' >&2
  exit 1
fi

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "${SCRIPT_DIRECTORY}/.." && pwd -P)"
PACKAGE_PATH="${PROJECT_ROOT}/package.json"
VERSION_TOOL="${SCRIPT_DIRECTORY}/release-version.mjs"

cd "${PROJECT_ROOT}"

fail() {
  echo "发布失败：$*" >&2
  exit 1
}

for required_command in git node pnpm gh; do
  command -v "${required_command}" >/dev/null 2>&1 || fail "缺少命令 ${required_command}。"
done

current_branch="$(git branch --show-current)"
[[ "${current_branch}" == 'main' ]] || fail "当前分支是 ${current_branch:-detached HEAD}，请切换到 main。"
[[ -z "$(git status --porcelain)" ]] || fail '工作区不干净，请先提交或处理现有改动。'
git remote get-url origin >/dev/null 2>&1 || fail '没有找到 origin 远程仓库。'
gh auth status --hostname github.com >/dev/null 2>&1 || fail 'GitHub CLI 尚未登录，请先执行 gh auth login。'

package_name="$(node -p "require('./package.json').name")"
current_version="$(node -p "require('./package.json').version")"
node "${VERSION_TOOL}" next "${current_version}" z >/dev/null

selected_part='z'
parts=('x' 'y' 'z')
selected_index=2

while true; do
  printf '\r请选择升级位（方向键切换，直接回车默认升级 z）：'
  for index in 0 1 2; do
    if [[ "${index}" -eq "${selected_index}" ]]; then
      printf ' (●) %s ' "${parts[${index}]}"
    else
      printf ' ( ) %s ' "${parts[${index}]}"
    fi
  done
  printf ' '

  IFS= read -rsn1 key
  if [[ -z "${key}" ]]; then
    selected_part="${parts[${selected_index}]}"
    printf '\n'
    break
  fi

  case "${key}" in
    x|X)
      selected_index=0
      ;;
    y|Y)
      selected_index=1
      ;;
    z|Z)
      selected_index=2
      ;;
    $'\x1b')
      IFS= read -rsn2 arrow_key || true
      case "${arrow_key}" in
        '[A'|'[D')
          selected_index=$(( (selected_index + 2) % 3 ))
          ;;
        '[B'|'[C')
          selected_index=$(( (selected_index + 1) % 3 ))
          ;;
      esac
      ;;
  esac
done

new_version="$(node "${VERSION_TOOL}" next "${current_version}" "${selected_part}")"
release_tag="v${new_version}"

existing_tags=("v${current_version}")
while IFS= read -r tag; do
  [[ -n "${tag}" ]] && existing_tags+=("${tag}")
done < <(
  {
    git tag --list 'v*'
    git ls-remote --tags --refs origin 'v*' | awk '{ sub("refs/tags/", "", $2); print $2 }'
  } | sort -u
)
node "${VERSION_TOOL}" validate "${new_version}" "${existing_tags[@]}" >/dev/null

git rev-parse --verify --quiet "refs/tags/${release_tag}" >/dev/null && \
  fail "本地 tag ${release_tag} 已存在。"
[[ -z "$(git ls-remote --tags origin "refs/tags/${release_tag}")" ]] || \
  fail "远程 tag ${release_tag} 已存在。"

release_notes=''
while ! node "${VERSION_TOOL}" notes "${release_notes}" >/dev/null 2>&1; do
  read -r -p '请输入本次 Tag/Release 说明（不能为空）：' release_notes
  if ! node "${VERSION_TOOL}" notes "${release_notes}" >/dev/null 2>&1; then
    echo '说明不能为空，请重新输入。' >&2
  fi
done

package_backup="$(mktemp "${TMPDIR:-/tmp}/xianyu-assistant-package.XXXXXX")"
cp "${PACKAGE_PATH}" "${package_backup}"
version_committed='false'

cleanup() {
  exit_status=$?
  trap - EXIT INT TERM
  if [[ "${version_committed}" != 'true' ]]; then
    git restore --staged -- package.json >/dev/null 2>&1 || true
    cp "${package_backup}" "${PACKAGE_PATH}"
  fi
  rm -f "${package_backup}"
  exit "${exit_status}"
}
trap cleanup EXIT INT TERM

node "${VERSION_TOOL}" set "${PACKAGE_PATH}" "${new_version}"

echo
echo "正在检查并构建 ${release_tag}……"
pnpm check

metadata="$(node "${VERSION_TOOL}" metadata "${package_name}" "${new_version}")"
crx_path="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.crx)' "${metadata}")"
zip_path="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.zip)' "${metadata}")"
[[ -f "${crx_path}" ]] || fail "没有生成 ${crx_path}。"
[[ -f "${zip_path}" ]] || fail "没有生成 ${zip_path}。"

manifest_version="$(node -p "require('./.output/chrome-mv3/manifest.json').version")"
[[ "${manifest_version}" == "${new_version}" ]] || \
  fail "Manifest 版本 ${manifest_version} 与 package.json 版本 ${new_version} 不一致。"

echo
echo '发布预览：'
echo "  当前版本：${current_version}"
echo "  新版本：  ${new_version}"
echo "  Git tag：  ${release_tag}"
echo "  CRX：      ${crx_path}"
echo "  ZIP：      ${zip_path}"
echo "  说明：     ${release_notes}"
echo

read -r -p '确认提交、推送并创建 GitHub Release？[y/N] ' confirmation
if [[ ! "${confirmation}" =~ ^[Yy]$ ]]; then
  echo '已取消发布；package.json 将恢复，未创建提交或远程 tag。'
  exit 0
fi

git add -- package.json
git commit -m "chore(release): 发布 ${release_tag}"
version_committed='true'

echo "正在推送 ${current_branch}……"
git push origin "${current_branch}"

echo "正在创建 ${release_tag} 并上传发布产物……"
git tag --annotate "${release_tag}" --message "${release_notes}"
git push origin "${release_tag}"
gh release create "${release_tag}" "${crx_path}" "${zip_path}" \
  --verify-tag \
  --title "${release_tag}" \
  --notes "${release_notes}"
release_url="$(gh release view "${release_tag}" --json url --jq '.url')"

echo
echo "发布成功：${release_url}"
