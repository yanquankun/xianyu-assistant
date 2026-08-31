import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  waitForTabSettled,
  type SettledBrowserTab,
  type TabRemovedListener,
  type TabSettledDependencies,
  type TabUpdatedListener
} from '../../src/background/tab-settle';

class ListenerSet<T> {
  readonly listeners = new Set<T>();

  addListener(listener: T): void {
    this.listeners.add(listener);
  }

  removeListener(listener: T): void {
    this.listeners.delete(listener);
  }
}

function createFake(initial: SettledBrowserTab) {
  let tab = initial;
  const updated = new ListenerSet<TabUpdatedListener>();
  const removed = new ListenerSet<TabRemovedListener>();
  const dependencies: TabSettledDependencies = {
    get: () => Promise.resolve(tab),
    onUpdated: updated,
    onRemoved: removed
  };
  return {
    dependencies,
    update(changeInfo: { status?: string; url?: string }, next: SettledBrowserTab): void {
      tab = next;
      for (const listener of updated.listeners) {
        listener(next.id, changeInfo, next);
      }
    },
    remove(tabId: number): void {
      for (const listener of removed.listeners) {
        listener(tabId);
      }
    },
    listenerCount(): number {
      return updated.listeners.size + removed.listeners.size;
    }
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('waitForTabSettled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次 complete 后继续跳转，并从最终 URL complete 起等待 800ms 安静窗口', async () => {
    const fake = createFake({ id: 8, url: 'https://3.cn/first', status: 'complete' });
    let resolved = false;
    const result = waitForTabSettled(fake.dependencies, 8, 'https://3.cn/first', {
      quietMs: 800,
      timeoutMs: 5_000
    }).then((tab) => {
      resolved = true;
      return tab;
    });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(400);
    fake.update(
      { url: 'https://item.jd.com/product/100.html', status: 'loading' },
      { id: 8, url: 'https://item.jd.com/product/100.html', status: 'loading' }
    );
    fake.update(
      { status: 'complete' },
      { id: 8, url: 'https://item.jd.com/product/100.html', status: 'complete' }
    );
    await vi.advanceTimersByTimeAsync(799);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({
      url: 'https://item.jd.com/product/100.html',
      status: 'complete'
    });
    expect(fake.listenerCount()).toBe(0);
  });

  it('最后一次 URL 更新会重新开始安静窗口', async () => {
    const fake = createFake({
      id: 9,
      url: 'https://item.taobao.com/item.htm?id=1',
      status: 'complete'
    });
    let resolved = false;
    const result = waitForTabSettled(fake.dependencies, 9, 'https://e.tb.cn/h.test', {
      quietMs: 800,
      timeoutMs: 5_000
    }).then((tab) => {
      resolved = true;
      return tab;
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(700);
    fake.update(
      { url: 'https://detail.tmall.com/item.htm?id=1', status: 'complete' },
      { id: 9, url: 'https://detail.tmall.com/item.htm?id=1', status: 'complete' }
    );
    await vi.advanceTimersByTimeAsync(799);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ url: 'https://detail.tmall.com/item.htm?id=1' });
    expect(fake.listenerCount()).toBe(0);
  });

  it('超时和标签页关闭均失败并清理监听器', async () => {
    const timeoutFake = createFake({ id: 10, url: 'https://3.cn/slow', status: 'loading' });
    const timeout = waitForTabSettled(timeoutFake.dependencies, 10, 'https://3.cn/slow', {
      quietMs: 800,
      timeoutMs: 1_000
    });
    await flushPromises();
    const timeoutExpectation = expect(timeout).rejects.toThrow('页面加载超时');
    await vi.advanceTimersByTimeAsync(1_000);
    await timeoutExpectation;
    expect(timeoutFake.listenerCount()).toBe(0);

    const removedFake = createFake({ id: 11, url: 'https://e.tb.cn/closed', status: 'loading' });
    const removed = waitForTabSettled(removedFake.dependencies, 11, 'https://e.tb.cn/closed');
    await flushPromises();
    const removedExpectation = expect(removed).rejects.toThrow('页面在加载完成前被关闭');
    removedFake.remove(11);
    await removedExpectation;
    expect(removedFake.listenerCount()).toBe(0);
  });

  it('短链跳转到跨平台目标时立即拒绝并清理监听器', async () => {
    const fake = createFake({ id: 12, url: 'https://3.cn/wrong', status: 'loading' });
    const result = waitForTabSettled(fake.dependencies, 12, 'https://3.cn/wrong');
    await flushPromises();
    const expectation = expect(result).rejects.toThrow('商品页跳转到了不受支持的站点');
    fake.update(
      { url: 'https://item.taobao.com/item.htm?id=1', status: 'complete' },
      { id: 12, url: 'https://item.taobao.com/item.htm?id=1', status: 'complete' }
    );

    await expectation;
    expect(fake.listenerCount()).toBe(0);
  });
});
