import { describe, expect, it, vi } from 'vitest';

import {
  withResolvedProductTab,
  type ProductTabOrchestratorDependencies
} from '../../src/background/product-tab-orchestrator';
import type { BrowserTab } from '../../src/background/tabs';

function tab(id: number, url: string): BrowserTab {
  return { id, url, active: false, windowId: 1 };
}

describe('withResolvedProductTab', () => {
  it('短链落地后切换到已有同商品页，只关闭扩展临时页', async () => {
    const existing = tab(7, 'https://item.jd.com/100.html?utm_source=share#detail');
    const temporary = tab(40, 'https://3.cn/short');
    const listTabs = vi
      .fn<() => Promise<BrowserTab[]>>()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([existing, temporary]);
    const create = vi.fn(() => Promise.resolve(temporary));
    const remove = vi.fn(() => Promise.resolve());
    const waitForSettled = vi.fn((tabId: number) =>
      Promise.resolve({
        id: tabId,
        url:
          tabId === 40
            ? 'https://item.m.jd.com/product/100.html?utm_source=short'
            : 'https://item.jd.com/100.html?utm_source=share#detail',
        status: 'complete'
      })
    );
    const prepare = vi.fn(() => Promise.resolve());
    const waitForReady = vi.fn(() => Promise.resolve());
    const dependencies: ProductTabOrchestratorDependencies = {
      listTabs,
      create,
      remove,
      waitForSettled,
      prepare,
      waitForReady
    };

    const result = await withResolvedProductTab(
      dependencies,
      'https://3.cn/short',
      (tabId, identity) => Promise.resolve({ tabId, identity })
    );

    expect(result).toMatchObject({
      tabId: 7,
      identity: {
        platform: 'jd',
        productId: '100',
        canonicalUrl: 'https://item.jd.com/100.html'
      }
    });
    expect(create).toHaveBeenCalledWith('https://3.cn/short', false);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(7);
    expect(waitForReady).toHaveBeenCalledWith(7);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(40);
  });

  it('完整链接会直接复用已有同商品页，不创建或关闭标签页', async () => {
    const existing = tab(9, 'https://item.m.jd.com/product/200.html?utm_source=share');
    const create = vi.fn(() => Promise.reject(new Error('不应创建')));
    const remove = vi.fn(() => Promise.resolve());
    const dependencies: ProductTabOrchestratorDependencies = {
      listTabs: vi.fn(() => Promise.resolve([existing])),
      create,
      remove,
      waitForSettled: vi.fn(() =>
        Promise.resolve({
          id: 9,
          url: 'https://item.m.jd.com/product/200.html?utm_source=share',
          status: 'complete'
        })
      ),
      prepare: vi.fn(() => Promise.resolve()),
      waitForReady: vi.fn(() => Promise.resolve())
    };

    const result = await withResolvedProductTab(
      dependencies,
      'https://item.jd.com/200.html?spm=share',
      (tabId, identity) => Promise.resolve({ tabId, canonicalUrl: identity.canonicalUrl })
    );

    expect(result).toEqual({
      tabId: 9,
      canonicalUrl: 'https://item.m.jd.com/product/200.html'
    });
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('临时页在语义等待失败时仍会被关闭', async () => {
    const temporary = tab(41, 'https://3.cn/slow');
    const remove = vi.fn(() => Promise.resolve());
    const dependencies: ProductTabOrchestratorDependencies = {
      listTabs: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([temporary]),
      create: vi.fn(() => Promise.resolve(temporary)),
      remove,
      waitForSettled: vi.fn(() =>
        Promise.resolve({ id: 41, url: 'https://item.jd.com/300.html', status: 'complete' })
      ),
      prepare: vi.fn(() => Promise.resolve()),
      waitForReady: vi.fn(() => Promise.reject(new Error('商品页面尚未准备完成，请稍后重试')))
    };

    const result = withResolvedProductTab(dependencies, 'https://3.cn/slow', () =>
      Promise.resolve('不应执行')
    );

    await expect(result).rejects.toThrow('商品页面尚未准备完成，请稍后重试');
    expect(remove).toHaveBeenCalledWith(41);
  });
});
