import { describe, expect, it } from 'vitest';

import {
  checkXianyuLoginFromTabs,
  type LoginCheckDependencies
} from '../../src/background/login-check';

function dependencies(
  overrides: Partial<LoginCheckDependencies> = {}
): LoginCheckDependencies {
  return {
    listTabs: () => Promise.resolve([]),
    getActiveTabId: () => Promise.resolve(undefined),
    readLoginState: () => Promise.resolve('unknown'),
    ...overrides
  };
}

describe('checkXianyuLoginFromTabs', () => {
  it('没有闲鱼页面时不创建标签页并返回可操作提示', async () => {
    await expect(checkXianyuLoginFromTabs(dependencies())).resolves.toEqual({
      state: 'unknown',
      message: '未找到闲鱼页面，请先打开或登录闲鱼'
    });
  });

  it('优先检查当前活动的闲鱼页面', async () => {
    const checked: number[] = [];

    const result = await checkXianyuLoginFromTabs(
      dependencies({
        listTabs: () =>
          Promise.resolve([
            { id: 1, url: 'https://www.goofish.com/publish', active: false, windowId: 1 },
            { id: 2, url: 'https://www.goofish.com/', active: true, windowId: 1 }
          ]),
        getActiveTabId: () => Promise.resolve(2),
        readLoginState: (tabId) => {
          checked.push(tabId);
          return Promise.resolve('logged-in');
        }
      })
    );

    expect(result).toEqual({ state: 'logged-in', message: '闲鱼已登录' });
    expect(checked).toEqual([2]);
  });

  it('检测异常时降级为未知状态且不沿用旧结论', async () => {
    const result = await checkXianyuLoginFromTabs(
      dependencies({
        listTabs: () =>
          Promise.resolve([
            { id: 1, url: 'https://www.goofish.com/publish', active: true, windowId: 1 }
          ]),
        getActiveTabId: () => Promise.resolve(1),
        readLoginState: () => Promise.reject(new Error('内容脚本不可用'))
      })
    );

    expect(result).toEqual({ state: 'unknown', message: '检查闲鱼登录状态失败，请重试' });
  });

  it('内容脚本返回非法登录状态时降级为中文失败提示', async () => {
    const result = await checkXianyuLoginFromTabs(
      dependencies({
        listTabs: () =>
          Promise.resolve([
            { id: 1, url: 'https://www.goofish.com/publish', active: true, windowId: 1 }
          ]),
        getActiveTabId: () => Promise.resolve(1),
        readLoginState: () => Promise.resolve('invalid-login-state')
      })
    );

    expect(result).toEqual({ state: 'unknown', message: '检查闲鱼登录状态失败，请重试' });
  });
});
