import { parseXianyuLoginState, type XianyuLoginState } from './login';

export interface XianyuContentDependencies {
  waitForComplete(tabId: number): Promise<void>;
  getTabUrl(tabId: number): Promise<string | undefined>;
  sendMessage<T>(tabId: number, message: unknown): Promise<T>;
  inject(tabId: number): Promise<void>;
  waitForRetry(delayMs: number): Promise<void>;
}

export interface XianyuLoginWaitOptions {
  attempts: number;
  intervalMs: number;
}

const DEFAULT_LOGIN_WAIT: XianyuLoginWaitOptions = { attempts: 40, intervalMs: 250 };

function isXianyuPage(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    return new URL(value).hostname.toLowerCase() === 'www.goofish.com';
  } catch {
    return false;
  }
}

export async function sendXianyuMessage<T>(
  dependencies: XianyuContentDependencies,
  tabId: number,
  message: unknown
): Promise<T> {
  await dependencies.waitForComplete(tabId);
  const tabUrl = await dependencies.getTabUrl(tabId);
  if (!isXianyuPage(tabUrl)) {
    throw new Error('目标标签页已离开闲鱼，请重新操作');
  }
  try {
    return await dependencies.sendMessage<T>(tabId, message);
  } catch {
    await dependencies.inject(tabId);
    return dependencies.sendMessage<T>(tabId, message);
  }
}

export async function waitForXianyuLoginState(
  dependencies: XianyuContentDependencies,
  tabId: number,
  options: XianyuLoginWaitOptions = DEFAULT_LOGIN_WAIT
): Promise<XianyuLoginState> {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const state = parseXianyuLoginState(
      await sendXianyuMessage<unknown>(dependencies, tabId, { type: 'CHECK_XIANYU_LOGIN' })
    );
    if (state === null) {
      throw new Error('闲鱼页面返回了无效的登录状态');
    }
    if (state !== 'unknown') {
      return state;
    }
    if (attempt + 1 < options.attempts) {
      await dependencies.waitForRetry(options.intervalMs);
    }
  }
  return 'unknown';
}
