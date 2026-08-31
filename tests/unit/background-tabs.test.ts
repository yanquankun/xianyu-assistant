import { describe, expect, it } from 'vitest';

import { withSourceTab, type BrowserTab } from '../../src/background/tabs';

const existing: BrowserTab = {
  id: 31,
  url: 'https://item.jd.com/product/1.html',
  active: true,
  windowId: 4
};

describe('withSourceTab', () => {
  it('复用用户已有标签页时不创建也不关闭', async () => {
    const created: string[] = [];
    const removed: number[] = [];
    const value = await withSourceTab(
      {
        create: (url) => {
          created.push(url);
          return Promise.resolve({ ...existing, id: 99, url });
        },
        remove: (tabId) => {
          removed.push(tabId);
          return Promise.resolve();
        }
      },
      [existing],
      'https://item.jd.com/product/1.html',
      (tab) => Promise.resolve(tab.id)
    );

    expect(value).toBe(31);
    expect(created).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('扩展创建的临时标签页在失败出口关闭', async () => {
    const removed: number[] = [];
    const result = withSourceTab(
      {
        create: (url) => Promise.resolve({ ...existing, id: 41, url, active: false }),
        remove: (tabId) => {
          removed.push(tabId);
          return Promise.resolve();
        }
      },
      [],
      'https://3.cn/short',
      () => Promise.reject(new Error('稳定等待失败'))
    );

    await expect(result).rejects.toThrow('稳定等待失败');
    expect(removed).toEqual([41]);
  });
});
