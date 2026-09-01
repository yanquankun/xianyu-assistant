import { describe, expect, it } from 'vitest';

import { parseProductIdentity } from '../../src/domain/product-url';
import {
  selectProductSourceTab,
  selectXianyuLoginTab,
  selectXianyuTab,
  withTemporaryTab,
  type BrowserTab
} from '../../src/background/tabs';

const tabs: BrowserTab[] = [
  { id: 1, url: 'https://example.com/', active: true, windowId: 7 },
  { id: 2, url: 'https://www.goofish.com/publish', active: false, windowId: 7 },
  { id: 3, url: 'https://item.jd.com/1.html#detail', active: false, windowId: 7 }
];

describe('selectProductSourceTab', () => {
  it('忽略移动端域名、跟踪参数和 hash，按商品身份复用标签页', () => {
    const identity = parseProductIdentity(
      'https://item.m.jd.com/product/1.html?utm_source=share#detail'
    );
    if (identity === null) {
      throw new Error('测试商品身份无效');
    }

    expect(selectProductSourceTab(tabs, identity)).toEqual({
      kind: 'reuse',
      tabId: 3
    });
  });

  it('SKU 明确冲突时不复用同一商品的其他规格标签页', () => {
    const identity = parseProductIdentity(
      'https://detail.tmall.com/item.htm?id=100&skuId=3'
    );
    if (identity === null) {
      throw new Error('测试商品身份无效');
    }
    const tmallTabs: BrowserTab[] = [
      {
        id: 8,
        url: 'https://detail.tmall.com/item.htm?id=100&skuId=2&spm=share',
        active: false,
        windowId: 7
      }
    ];

    expect(selectProductSourceTab(tmallTabs, identity)).toEqual({ kind: 'create' });
  });

  it('可排除扩展刚创建的临时标签页', () => {
    const identity = parseProductIdentity('https://item.jd.com/1.html');
    if (identity === null) {
      throw new Error('测试商品身份无效');
    }

    expect(selectProductSourceTab(tabs, identity, 3)).toEqual({ kind: 'create' });
  });
});

describe('selectXianyuTab', () => {
  it('当前标签页是闲鱼时优先复用当前页', () => {
    const activeXianyuTabs: BrowserTab[] = tabs.map((tab) => ({
      ...tab,
      active: tab.id === 2
    }));

    expect(selectXianyuTab(activeXianyuTabs, 2)).toEqual({ tabId: 2, reusedActiveTab: true });
  });

  it('当前页不是闲鱼时复用已有闲鱼标签页', () => {
    expect(selectXianyuTab(tabs, 1)).toEqual({ tabId: 2, reusedActiveTab: false });
  });

  it('没有闲鱼页面时返回空值', () => {
    const nonXianyuTab = tabs.at(0);
    if (nonXianyuTab === undefined) {
      throw new Error('测试需要非闲鱼标签页');
    }
    expect(selectXianyuTab([nonXianyuTab], 1)).toBeNull();
  });
});

describe('selectXianyuLoginTab', () => {
  it('只复用登录页，不把已有发布页导航到登录页', () => {
    const xianyuTabs: BrowserTab[] = [
      { id: 1, url: 'https://www.goofish.com/publish', active: true, windowId: 1 },
      { id: 2, url: 'https://www.goofish.com/login?from=publish', active: false, windowId: 1 }
    ];

    expect(selectXianyuLoginTab(xianyuTabs)).toBe(2);
    expect(selectXianyuLoginTab(xianyuTabs.slice(0, 1))).toBeNull();
  });
});

describe('withTemporaryTab', () => {
  it('操作完成后只关闭扩展创建的临时标签页', async () => {
    const removed: number[] = [];
    const result = await withTemporaryTab(
      {
        create: () => Promise.resolve({ id: 40, url: 'https://item.jd.com/2.html', active: false, windowId: 7 }),
        remove: (tabId) => {
          removed.push(tabId);
          return Promise.resolve();
        }
      },
      'https://item.jd.com/2.html',
      (tab) => Promise.resolve(`parsed-${String(tab.id)}`)
    );

    expect(result).toBe('parsed-40');
    expect(removed).toEqual([40]);
  });

  it('解析失败时仍关闭自己创建的临时标签页', async () => {
    const removed: number[] = [];
    const operation = withTemporaryTab(
      {
        create: () => Promise.resolve({ id: 41, url: 'https://item.jd.com/3.html', active: false, windowId: 7 }),
        remove: (tabId) => {
          removed.push(tabId);
          return Promise.resolve();
        }
      },
      'https://item.jd.com/3.html',
      () => Promise.reject(new Error('解析失败'))
    );

    await expect(operation).rejects.toThrow('解析失败');
    expect(removed).toEqual([41]);
  });
});
