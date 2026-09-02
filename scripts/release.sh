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
GITHUB_AUTH_CHECK="${SCRIPT_DIRECTORY}/check-github-auth.sh"
RELEASE_UI="${SCRIPT_DIRECTORY}/release-ui.sh"

source "${RELEASE_UI}"

cd "${PROJECT_ROOT}"

fail() {
  ui_error "发布失败：$*"
  exit 1
}

ui_heading '闲鱼上架助手 · GitHub Release'
ui_step '1/5' '检查本地环境与 GitHub 登录状态'

for required_command in git node pnpm gh; do
  command -v "${required_command}" >/dev/null 2>&1 || fail "缺少命令 ${required_command}。"
done

current_branch="$(git branch --show-current)"
[[ "${current_branch}" == 'main' ]] || fail "当前分支是 ${current_branch:-detached HEAD}，请切换到 main。"
[[ -z "$(git status --porcelain)" ]] || fail '工作区不干净，请先提交或处理现有改动。'
git remote get-url origin >/dev/null 2>&1 || fail '没有找到 origin 远程仓库。'
bash "${GITHUB_AUTH_CHECK}"

package_name="$(node -p "require('./package.json').name")"
current_version="$(node -p "require('./package.json').version")"
node "${VERSION_TOOL}" next "${current_version}" z >/dev/null

ui_success "当前分支 main，当前版本 ${current_version}"

patch_version="$(node "${VERSION_TOOL}" next "${current_version}" z)"
minor_version="$(node "${VERSION_TOOL}" next "${current_version}" y)"
major_version="$(node "${VERSION_TOOL}" next "${current_version}" x)"

echo
ui_step '2/5' '选择发布版本'
if ! choose_version_part \
  "${current_version}" \
  "${patch_version}" \
  "${minor_version}" \
  "${major_version}"; then
  ui_cancelled '已取消发布，未修改任何文件。'
  exit 0
fi
selected_part="${UI_SELECTED_VALUE}"

new_version="$(node "${VERSION_TOOL}" next "${current_version}" "${selected_part}")"
release_tag="v${new_version}"
ui_success "已选择 ${current_version} → ${new_version}"

ui_step '3/5' '检查本地与远程版本'
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
ui_success "${release_tag} 可用，且高于已有版本"

release_notes=''
ui_heading '填写发布说明'
printf '%b说明将同时写入 Git tag 和 GitHub Release。%b\n' "${UI_DIM}" "${UI_RESET}"
while ! node "${VERSION_TOOL}" notes "${release_notes}" >/dev/null 2>&1; do
  printf '%b说明 › %b' "${UI_CYAN}${UI_BOLD}" "${UI_RESET}"
  read -r release_notes
  if ! node "${VERSION_TOOL}" notes "${release_notes}" >/dev/null 2>&1; then
    ui_error '说明不能为空，请重新输入。'
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
ui_step '4/5' "运行完整检查并构建 ${release_tag}"
pnpm check

metadata="$(node "${VERSION_TOOL}" metadata "${package_name}" "${new_version}")"
crx_path="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.crx)' "${metadata}")"
zip_path="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.zip)' "${metadata}")"
[[ -f "${crx_path}" ]] || fail "没有生成 ${crx_path}。"
[[ -f "${zip_path}" ]] || fail "没有生成 ${zip_path}。"

manifest_version="$(node -p "require('./.output/chrome-mv3/manifest.json').version")"
[[ "${manifest_version}" == "${new_version}" ]] || \
  fail "Manifest 版本 ${manifest_version} 与 package.json 版本 ${new_version} 不一致。"
ui_success '代码检查、测试和生产构建通过'

ui_heading '发布预览'
printf '┌─ %s\n' "${release_tag}"
printf '│ 当前版本  %s\n' "${current_version}"
printf '│ 新版本    %s\n' "${new_version}"
printf '│ CRX       %s\n' "$(basename "${crx_path}")"
printf '│ ZIP       %s\n' "$(basename "${zip_path}")"
printf '│ 说明      %s\n' "${release_notes}"
printf '└─\n\n'

if ! confirm_release; then
  ui_cancelled '已取消发布；package.json 将恢复，未创建提交或远程 tag。'
  exit 0
fi

echo
ui_step '5/5' '提交、推送并创建 GitHub Release'
git add -- package.json
git commit -m "chore(release): 发布 ${release_tag}"
version_committed='true'

ui_step '推送' "推送 ${current_branch}"
git push origin "${current_branch}"

ui_step 'Tag' "创建并推送 ${release_tag}"
git tag --annotate "${release_tag}" --message "${release_notes}"
git push origin "${release_tag}"
ui_step 'Release' '创建 GitHub Release 并上传 CRX、ZIP'
gh release create "${release_tag}" "${crx_path}" "${zip_path}" \
  --verify-tag \
  --title "${release_tag}" \
  --notes "${release_notes}"
release_url="$(gh release view "${release_tag}" --json url --jq '.url')"

echo
ui_success "发布成功：${release_url}"
