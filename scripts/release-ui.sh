#!/usr/bin/env bash

if [[ -n "${RELEASE_UI_PLAIN:-}" || ( ! -t 1 && -z "${RELEASE_UI_FORCE_COLOR:-}" ) ]]; then
  UI_BOLD=''
  UI_CYAN=''
  UI_GREEN=''
  UI_RED=''
  UI_DIM=''
  UI_RESET=''
  UI_CLEAR_LINE=''
else
  UI_BOLD=$'\033[1m'
  UI_CYAN=$'\033[36m'
  UI_GREEN=$'\033[32m'
  UI_RED=$'\033[31m'
  UI_DIM=$'\033[2m'
  UI_RESET=$'\033[0m'
  UI_CLEAR_LINE=$'\033[2K\r'
fi

ui_print_line() {
  printf '%s%b%s%b\n' "${UI_CLEAR_LINE}" "${2:-}" "$1" "${UI_RESET}"
}

ui_heading() {
  printf '\n%b%s%b\n' "${UI_BOLD}${UI_CYAN}" "$1" "${UI_RESET}"
}

ui_step() {
  printf '%b[%s]%b %s\n' "${UI_CYAN}${UI_BOLD}" "$1" "${UI_RESET}" "$2"
}

ui_success() {
  printf '%b✓%b %s\n' "${UI_GREEN}${UI_BOLD}" "${UI_RESET}" "$1"
}

ui_error() {
  printf '%b×%b %s\n' "${UI_RED}${UI_BOLD}" "${UI_RESET}" "$1" >&2
}

ui_cancelled() {
  printf '%b—%b %s\n' "${UI_DIM}" "${UI_RESET}" "$1"
}

move_selection() {
  local current_index="$1"
  local direction="$2"
  local item_count="$3"

  if [[ "${direction}" == 'up' ]]; then
    printf '%s\n' "$(( (current_index + item_count - 1) % item_count ))"
  else
    printf '%s\n' "$(( (current_index + 1) % item_count ))"
  fi
}

render_version_menu() {
  local selected_index="$1"
  local current_version="$2"
  local patch_version="$3"
  local minor_version="$4"
  local major_version="$5"
  local prefixes=('  ' '  ' '  ')

  prefixes[${selected_index}]='❯ '
  ui_print_line '请选择版本升级类型' "${UI_BOLD}${UI_CYAN}"
  ui_print_line ''
  ui_print_line "${prefixes[0]}z  补丁版本  ${current_version} → ${patch_version}（默认）" "$([[ "${selected_index}" -eq 0 ]] && printf '%s' "${UI_BOLD}${UI_CYAN}")"
  ui_print_line "${prefixes[1]}y  次版本    ${current_version} → ${minor_version}" "$([[ "${selected_index}" -eq 1 ]] && printf '%s' "${UI_BOLD}${UI_CYAN}")"
  ui_print_line "${prefixes[2]}x  主版本    ${current_version} → ${major_version}" "$([[ "${selected_index}" -eq 2 ]] && printf '%s' "${UI_BOLD}${UI_CYAN}")"
  ui_print_line ''
  ui_print_line '↑/↓ 选择，Enter 确认，q 取消' "${UI_DIM}"
}

render_confirmation_menu() {
  local selected_index="$1"
  local prefixes=('  ' '  ')

  prefixes[${selected_index}]='❯ '
  ui_print_line '确认发布到 GitHub？' "${UI_BOLD}${UI_CYAN}"
  ui_print_line ''
  ui_print_line "${prefixes[0]}确认发布" "$([[ "${selected_index}" -eq 0 ]] && printf '%s' "${UI_BOLD}${UI_CYAN}")"
  ui_print_line "${prefixes[1]}取消并恢复版本（默认）" "$([[ "${selected_index}" -eq 1 ]] && printf '%s' "${UI_BOLD}${UI_CYAN}")"
  ui_print_line ''
  ui_print_line '↑/↓ 选择，Enter 确认，q 取消' "${UI_DIM}"
}

read_arrow_selection() {
  local item_count="$1"
  local selected_index="$2"
  local line_count="$3"
  local render_function="$4"
  shift 4

  "${render_function}" "${selected_index}" "$@"
  while true; do
    IFS= read -rsn1 key
    case "${key}" in
      '')
        UI_SELECTED_INDEX="${selected_index}"
        return 0
        ;;
      q|Q)
        return 1
        ;;
      $'\x1b')
        IFS= read -rsn2 arrow_key || true
        case "${arrow_key}" in
          '[A') selected_index="$(move_selection "${selected_index}" up "${item_count}")" ;;
          '[B') selected_index="$(move_selection "${selected_index}" down "${item_count}")" ;;
          *) continue ;;
        esac
        ;;
      *)
        continue
        ;;
    esac

    printf '\033[%sA' "${line_count}"
    "${render_function}" "${selected_index}" "$@"
  done
}

choose_version_part() {
  if ! read_arrow_selection 3 0 7 render_version_menu "$@"; then
    return 1
  fi
  case "${UI_SELECTED_INDEX}" in
    0) UI_SELECTED_VALUE='z' ;;
    1) UI_SELECTED_VALUE='y' ;;
    2) UI_SELECTED_VALUE='x' ;;
  esac
}

confirm_release() {
  if ! read_arrow_selection 2 1 6 render_confirmation_menu; then
    return 1
  fi
  [[ "${UI_SELECTED_INDEX}" -eq 0 ]]
}
