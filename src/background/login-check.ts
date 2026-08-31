import { selectXianyuTab, type BrowserTab } from './tabs';
import type { XianyuLoginCheckResult, XianyuLoginState } from '../xianyu/login';

export interface LoginCheckDependencies {
  listTabs: () => Promise<BrowserTab[]>;
  getActiveTabId: () => Promise<number | undefined>;
  readLoginState: (tabId: number) => Promise<XianyuLoginState>;
}

const NO_XIANYU_TAB: XianyuLoginCheckResult = {
  state: 'unknown',
  message: '未找到闲鱼页面，请先打开或登录闲鱼'
};

function messageFor(state: XianyuLoginState): string {
  if (state === 'logged-in') {
    return '闲鱼已登录';
  }
  if (state === 'logged-out') {
    return '需要登录闲鱼，请先完成登录';
  }
  return '尚未确认闲鱼登录状态，请稍后重试';
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? `检查闲鱼登录状态失败：${error.message}`
    : '检查闲鱼登录状态失败，请重试';
}

export async function checkXianyuLoginFromTabs(
  dependencies: LoginCheckDependencies
): Promise<XianyuLoginCheckResult> {
  try {
    const [tabs, activeTabId] = await Promise.all([
      dependencies.listTabs(),
      dependencies.getActiveTabId()
    ]);
    const selection = selectXianyuTab(tabs, activeTabId);
    if (selection === null) {
      return NO_XIANYU_TAB;
    }
    const state = await dependencies.readLoginState(selection.tabId);
    return { state, message: messageFor(state) };
  } catch (error) {
    return { state: 'unknown', message: errorMessage(error) };
  }
}
