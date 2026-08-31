import { describe, expect, it } from 'vitest';

import type { BrowserTab } from '../../src/background/tabs';
import {
  prepareXianyuPublishTab,
  XIANYU_PUBLISH_URL,
  type XianyuTabDependencies
} from '../../src/xianyu/tab-orchestrator';

interface CallLog {
  updates: { tabId: number; url: string; active: boolean }[];
  creates: { url: string; active: boolean }[];
}

function createDependencies(tabs: BrowserTab[], activeTabId: number): {
  dependencies: XianyuTabDependencies;
  calls: CallLog;
} {
  const calls: CallLog = { updates: [], creates: [] };
  return {
    calls,
    dependencies: {
      listTabs: () => Promise.resolve(tabs),
      getActiveTabId: () => Promise.resolve(activeTabId),
      update: (tabId, options) => {
        calls.updates.push({ tabId, ...options });
        return Promise.resolve({ id: tabId, url: options.url, active: options.active, windowId: 1 });
      },
      create: (options) => {
        calls.creates.push(options);
        return Promise.resolve({ id: 99, url: options.url, active: options.active, windowId: 1 });
      },
      waitForComplete: () => Promise.resolve()
    }
  };
}

describe('prepareXianyuPublishTab', () => {
  it('当前标签页已经是闲鱼发布页时直接复用', async () => {
    const { dependencies, calls } = createDependencies(
      [{ id: 2, url: XIANYU_PUBLISH_URL, active: true, windowId: 1 }],
      2
    );

    const result = await prepareXianyuPublishTab(dependencies);

    expect(result).toEqual({
      tabId: 2,
      reusedActiveTab: true,
      createdTab: false,
      navigatedToPublish: false
    });
    expect(calls.updates).toEqual([]);
    expect(calls.creates).toEqual([]);
  });

  it('当前页是闲鱼其他页面时导航到发布页', async () => {
    const { dependencies, calls } = createDependencies(
      [{ id: 2, url: 'https://www.goofish.com/', active: true, windowId: 1 }],
      2
    );

    const result = await prepareXianyuPublishTab(dependencies);

    expect(result.reusedActiveTab).toBe(true);
    expect(result.navigatedToPublish).toBe(true);
    expect(calls.updates).toEqual([{ tabId: 2, url: XIANYU_PUBLISH_URL, active: true }]);
  });

  it('当前页不是闲鱼时激活并导航已有闲鱼页', async () => {
    const { dependencies, calls } = createDependencies(
      [
        { id: 1, url: 'https://example.com/', active: true, windowId: 1 },
        { id: 2, url: 'https://www.goofish.com/personal', active: false, windowId: 1 }
      ],
      1
    );

    const result = await prepareXianyuPublishTab(dependencies);

    expect(result).toMatchObject({ tabId: 2, reusedActiveTab: false, createdTab: false });
    expect(calls.updates).toEqual([{ tabId: 2, url: XIANYU_PUBLISH_URL, active: true }]);
  });

  it('没有闲鱼页时新建发布页', async () => {
    const { dependencies, calls } = createDependencies(
      [{ id: 1, url: 'https://example.com/', active: true, windowId: 1 }],
      1
    );

    const result = await prepareXianyuPublishTab(dependencies);

    expect(result).toMatchObject({ tabId: 99, reusedActiveTab: false, createdTab: true });
    expect(calls.creates).toEqual([{ url: XIANYU_PUBLISH_URL, active: true }]);
  });
});
