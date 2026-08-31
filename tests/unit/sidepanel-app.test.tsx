import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ParsedProduct, ProductDraft } from '../../src/domain/product';
import type { StoredMediaMetadata } from '../../src/storage/media-store';
import type { XianyuLoginCheckResult } from '../../src/xianyu/login';
import type { FillResult } from '../../src/xianyu/fill';
import { App, type SidePanelServices } from '../../src/sidepanel/App';

const parsedProduct: ParsedProduct = {
  platform: 'taobao',
  canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
  title: '测试商品',
  description: '测试描述',
  price: 99,
  currency: 'CNY',
  images: [],
  warnings: [],
  confidence: 'high'
};

const readyDraft: ProductDraft = {
  id: 'ready-draft',
  platform: 'taobao',
  canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
  source: { title: '测试商品', description: '测试描述', price: 99, currency: 'CNY' },
  title: '测试商品',
  description: '测试描述',
  price: 99,
  currency: 'CNY',
  images: [
    {
      id: 'ready-image',
      location: {
        kind: 'remote',
        url: 'https://img.example.com/ready.jpg',
        extractedBy: 'dom'
      },
      selected: true,
      loadStatus: 'loaded'
    }
  ],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '',
  updatedAt: '2026-08-31T12:00:00.000Z'
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createServices(overrides: Partial<SidePanelServices> = {}): SidePanelServices {
  return {
    loadSettings: () => Promise.resolve(null),
    saveSettings: () => Promise.resolve(),
    loadDraft: () => Promise.resolve(null),
    saveDraft: () => Promise.resolve(),
    clearDraft: () => Promise.resolve(),
    saveMedia: (file, kind) =>
      Promise.resolve({
        assetId: `asset-${file.name}`,
        kind,
        fileName: file.name,
        mimeType: file.type,
        byteLength: file.size,
        createdAt: '2026-08-31T12:00:00.000Z'
      }),
    loadMedia: () => Promise.resolve(null),
    deleteMedia: () => Promise.resolve(),
    cleanupMedia: () => Promise.resolve(),
    parseProduct: () => Promise.resolve(parsedProduct),
    testAiConnection: () => Promise.resolve({ connected: true, model: 'gpt-test' }),
    expandDraft: () =>
      Promise.resolve({
        title: '扩写标题',
        description: '扩写描述',
        warnings: [],
        factWarnings: []
      }),
    checkXianyuLogin: () => Promise.resolve({ state: 'unknown', message: '尚未确认' }),
    fillDraft: () => Promise.resolve({ filled: [], skipped: [], warnings: [] }),
    openXianyuLogin: () => Promise.resolve(),
    getPanelSide: () => Promise.resolve('right'),
    loadLogs: () => Promise.resolve([]),
    ...overrides
  };
}

describe('App', () => {
  it('点击刷新时显示加载并立即采用最新登录状态', async () => {
    const checks: Promise<XianyuLoginCheckResult>[] = [
      Promise.resolve({ state: 'unknown', message: '尚未确认' }),
      new Promise<XianyuLoginCheckResult>((resolve) => {
        setTimeout(() => resolve({ state: 'logged-in', message: '已重新检查' }), 0);
      })
    ];
    render(
      <App
        services={createServices({
          checkXianyuLogin: () => checks.shift() ?? Promise.reject(new Error('测试调用过多'))
        })}
      />
    );

    await screen.findByText('尚未确认闲鱼登录状态');
    fireEvent.click(screen.getByRole('button', { name: '刷新闲鱼登录状态' }));

    const refreshButton = screen.getByRole('button', { name: '刷新闲鱼登录状态' });
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute('aria-busy', 'true');

    expect(await screen.findByText('闲鱼已登录')).toBeVisible();
    expect(await screen.findByText('已重新检查')).toBeVisible();
  });

  it('初始化检查晚于手动刷新时不覆盖最新登录结论', async () => {
    const initialCheck = createDeferred<XianyuLoginCheckResult>();
    const manualRefresh = createDeferred<XianyuLoginCheckResult>();
    const checks = [initialCheck, manualRefresh];
    render(
      <App
        services={createServices({
          checkXianyuLogin: () => {
            const check = checks.shift();
            if (check === undefined) {
              return Promise.reject(new Error('测试调用过多'));
            }
            return check.promise;
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '刷新闲鱼登录状态' }));
    manualRefresh.resolve({ state: 'logged-in', message: '手动刷新结果' });
    expect(await screen.findByText('手动刷新结果')).toBeVisible();

    initialCheck.resolve({ state: 'logged-out', message: '过期初始化结果' });
    await waitFor(() => expect(screen.getByText('手动刷新结果')).toBeVisible());
    expect(screen.getByText('闲鱼已登录')).toBeVisible();
  });

  it('填表失败后的旧复检不覆盖较新的手动刷新结果', async () => {
    const failedFillCheck = createDeferred<XianyuLoginCheckResult>();
    const manualRefresh = createDeferred<XianyuLoginCheckResult>();
    let checkCalls = 0;
    render(
      <App
        services={createServices({
          loadDraft: () => Promise.resolve(readyDraft),
          checkXianyuLogin: () => {
            checkCalls += 1;
            if (checkCalls === 1) {
              return Promise.resolve({ state: 'logged-in', message: '初始化结果' });
            }
            if (checkCalls === 2) {
              return failedFillCheck.promise;
            }
            if (checkCalls === 3) {
              return manualRefresh.promise;
            }
            return Promise.reject(new Error('测试调用过多'));
          },
          fillDraft: () => Promise.reject(new Error('填写失败'))
        })}
      />
    );

    const fillButton = await screen.findByRole('button', { name: '填入闲鱼' });
    fireEvent.load(screen.getByRole('img', { name: '商品图片 1' }));
    await waitFor(() => expect(fillButton).toBeEnabled());
    fireEvent.click(fillButton);
    await waitFor(() => expect(checkCalls).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: '刷新闲鱼登录状态' }));
    manualRefresh.resolve({ state: 'logged-in', message: '最新手动刷新结果' });
    expect(await screen.findByText('最新手动刷新结果')).toBeVisible();

    failedFillCheck.resolve({ state: 'logged-out', message: '过期复检结果' });
    await waitFor(() => expect(screen.getByText('最新手动刷新结果')).toBeVisible());
    expect(screen.getByText('闲鱼已登录')).toBeVisible();
  });

  it('后台返回非法登录结果时走未知状态失败分支', async () => {
    const invalidResult: XianyuLoginCheckResult = { state: 'unknown', message: '初始测试结果' };
    Reflect.set(invalidResult, 'state', 'unexpected');
    const services = createServices({
      checkXianyuLogin: () => Promise.resolve(invalidResult)
    });
    render(<App services={services} />);

    expect(await screen.findByText('检查闲鱼登录状态失败：扩展后台返回了无法识别的登录状态')).toBeVisible();
    expect(screen.getByText('尚未确认闲鱼登录状态')).toBeVisible();
  });

  it('未登录时显示提醒且禁用填表动作', async () => {
    render(
      <App
        services={createServices({
          checkXianyuLogin: () =>
            Promise.resolve({ state: 'logged-out', message: '请先完成闲鱼网页登录，草稿会保留在本地。' })
        })}
      />
    );

    expect(await screen.findByText('需要登录闲鱼')).toBeVisible();
    expect(screen.getByRole('button', { name: '填入闲鱼' })).toBeDisabled();
  });

  it('输入商品链接并解析后展示可编辑字段', async () => {
    const urls: string[] = [];
    render(
      <App
        services={createServices({
          parseProduct: (url) => {
            urls.push(url);
            return Promise.resolve(parsedProduct);
          }
        })}
      />
    );
    const input = screen.getByLabelText('商品链接');
    fireEvent.change(input, { target: { value: parsedProduct.canonicalUrl } });
    fireEvent.click(screen.getByRole('button', { name: '解析商品' }));

    await waitFor(() => expect(urls).toEqual([parsedProduct.canonicalUrl]));
    expect(await screen.findByDisplayValue('测试商品')).toBeVisible();
    expect(screen.getByDisplayValue('测试描述')).toBeVisible();
    expect(screen.getByDisplayValue('99')).toBeVisible();
    expect(screen.getByText('02')).toBeVisible();
    expect(screen.queryByText('高')).toBeNull();
  });

  it('空白手动草稿返回初始双入口并清除持久化草稿', async () => {
    let cleared = 0;
    render(
      <App
        services={createServices({
          clearDraft: () => {
            cleared += 1;
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    expect(await screen.findByText('02')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));

    await waitFor(() => expect(cleared).toBe(1));
    expect(screen.getByRole('button', { name: '解析商品' })).toBeVisible();
    expect(screen.getByRole('button', { name: '手动填写' })).toBeVisible();
    expect(screen.queryByLabelText('商品标题')).toBeNull();
    expect(screen.getByLabelText('商品链接')).toHaveFocus();
  });

  it('等待已入队草稿保存后才清除持久化草稿', async () => {
    const save = createDeferred<undefined>();
    const calls: string[] = [];
    render(
      <App
        services={createServices({
          saveDraft: () => {
            calls.push('save');
            return save.promise;
          },
          clearDraft: () => {
            calls.push('clear');
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    await waitFor(() => expect(calls).toEqual(['save']));
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    expect(calls).toEqual(['save']);

    save.resolve(undefined);
    await waitFor(() => expect(calls).toEqual(['save', 'clear']));
  });

  it('重置开始后不恢复迟到初始化读取的旧草稿', async () => {
    const oldDraft = { ...readyDraft, id: 'old-draft', title: '不应恢复的旧草稿' };
    const storedDraft = createDeferred<ProductDraft | null>();
    const savedTitles: string[] = [];
    let cleanupCalls = 0;
    render(
      <App
        services={createServices({
          loadDraft: () => storedDraft.promise,
          saveDraft: (draft) => {
            savedTitles.push(draft.title);
            return Promise.resolve();
          },
          cleanupMedia: () => {
            cleanupCalls += 1;
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    await waitFor(() => expect(savedTitles).toContain(''));
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    expect(await screen.findByRole('button', { name: '手动填写' })).toBeVisible();

    storedDraft.resolve(oldDraft);
    await waitFor(() => expect(cleanupCalls).toBeGreaterThan(0));
    expect(screen.queryByDisplayValue('不应恢复的旧草稿')).toBeNull();
    expect(savedTitles).not.toContain('不应恢复的旧草稿');
  });

  it('非空草稿取消返回确认后保留编辑内容', async () => {
    render(<App services={createServices()} />);

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    const title = await screen.findByLabelText('商品标题');
    fireEvent.change(title, { target: { value: '不能误删的标题' } });
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));

    expect(screen.getByRole('dialog', { name: '返回选择方式' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByDisplayValue('不能误删的标题')).toBeVisible();
  });

  it('关闭确认后将焦点恢复到返回选择方式', async () => {
    render(<App services={createServices()} />);

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    fireEvent.change(await screen.findByLabelText('商品标题'), { target: { value: '需要确认' } });
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.getByRole('button', { name: '返回选择方式' })).toHaveFocus();
  });

  it('确认框打开时隔离背景并让 Tab 焦点停留在确认操作内', async () => {
    render(<App services={createServices()} />);

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    fireEvent.change(await screen.findByLabelText('商品标题'), { target: { value: '需要确认' } });
    const title = screen.getByLabelText('商品标题');
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));

    expect(title.closest('[inert]')).not.toBeNull();
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认返回' });
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    expect(title).not.toHaveFocus();
  });

  it('确认打开后草稿被程序化更新时拒绝删除新版本', async () => {
    let cleared = 0;
    render(
      <App
        services={createServices({
          clearDraft: () => {
            cleared += 1;
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    const title = await screen.findByLabelText('商品标题');
    fireEvent.change(title, { target: { value: '确认时的标题' } });
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    fireEvent.change(title, { target: { value: '确认后更新的标题' } });
    fireEvent.click(screen.getByRole('button', { name: '确认返回' }));

    expect(await screen.findByText('草稿已更新，请重新确认返回')).toBeVisible();
    expect(cleared).toBe(0);
    expect(screen.getByDisplayValue('确认后更新的标题')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: '返回选择方式' })).toBeNull();
  });

  it('确认打开后异步媒体写入时拒绝删除新版本', async () => {
    const media = createDeferred<StoredMediaMetadata>();
    let cleared = 0;
    render(
      <App
        services={createServices({
          saveMedia: () => media.promise,
          clearDraft: () => {
            cleared += 1;
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    fireEvent.change(await screen.findByLabelText('商品标题'), { target: { value: '需要确认' } });
    fireEvent.change(screen.getByLabelText('上传商品图片'), {
      target: { files: [new File(['image'], 'late.png', { type: 'image/png' })] }
    });
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    media.resolve({
      assetId: 'late-image',
      kind: 'image',
      fileName: 'late.png',
      mimeType: 'image/png',
      byteLength: 5,
      createdAt: '2026-08-31T14:00:00.000Z'
    });
    expect(await screen.findByText('late.png')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认返回' }));

    expect(await screen.findByText('草稿已更新，请重新确认返回')).toBeVisible();
    expect(cleared).toBe(0);
    expect(screen.getByText('late.png')).toBeVisible();
  });

  it('清除草稿等待期间丢弃迟到媒体并补偿删除 Blob', async () => {
    const media = createDeferred<StoredMediaMetadata>();
    const clear = createDeferred<undefined>();
    const savedTitles: string[] = [];
    const deletedAssetIds: string[] = [];
    let clearCalls = 0;
    render(
      <App
        services={createServices({
          saveDraft: (draft) => {
            savedTitles.push(draft.title);
            return Promise.resolve();
          },
          saveMedia: () => media.promise,
          clearDraft: () => {
            clearCalls += 1;
            return clear.promise;
          },
          deleteMedia: (assetId) => {
            deletedAssetIds.push(assetId);
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    fireEvent.change(await screen.findByLabelText('商品标题'), { target: { value: '需要清除' } });
    fireEvent.change(screen.getByLabelText('上传商品图片'), {
      target: { files: [new File(['image'], 'after-clear.png', { type: 'image/png' })] }
    });
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    fireEvent.click(screen.getByRole('button', { name: '确认返回' }));
    await waitFor(() => expect(clearCalls).toBe(1));
    const saveCallsBeforeLateMedia = [...savedTitles];

    media.resolve({
      assetId: 'after-clear-media',
      kind: 'image',
      fileName: 'after-clear.png',
      mimeType: 'image/png',
      byteLength: 5,
      createdAt: '2026-08-31T15:00:00.000Z'
    });
    await waitFor(() => expect(deletedAssetIds).toContain('after-clear-media'));
    expect(screen.queryByText('after-clear.png')).toBeNull();
    expect(savedTitles).toEqual(saveCallsBeforeLateMedia);

    clear.resolve(undefined);
    expect(await screen.findByRole('button', { name: '手动填写' })).toBeVisible();
    expect(savedTitles).toEqual(saveCallsBeforeLateMedia);
  });

  it('草稿删除失败时保留编辑内容并显示清除错误', async () => {
    render(
      <App
        services={createServices({
          clearDraft: () => Promise.reject(new Error('存储不可用'))
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    fireEvent.change(await screen.findByLabelText('商品标题'), { target: { value: '保留的标题' } });
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    fireEvent.click(screen.getByRole('button', { name: '确认返回' }));

    expect(await screen.findByText('草稿清除失败：存储不可用')).toBeVisible();
    expect(screen.getByDisplayValue('保留的标题')).toBeVisible();
    expect(screen.getByRole('button', { name: '返回选择方式' })).toHaveFocus();
  });

  it('返回后丢弃迟到的填表完成结果', async () => {
    const fill = createDeferred<FillResult>();
    render(
      <App
        services={createServices({
          loadDraft: () => Promise.resolve(readyDraft),
          checkXianyuLogin: () => Promise.resolve({ state: 'logged-in', message: '闲鱼已登录' }),
          fillDraft: () => fill.promise
        })}
      />
    );

    const fillButton = await screen.findByRole('button', { name: '填入闲鱼' });
    fireEvent.load(screen.getByRole('img', { name: '商品图片 1' }));
    await waitFor(() => expect(fillButton).toBeEnabled());
    fireEvent.click(fillButton);
    fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));
    fireEvent.click(screen.getByRole('button', { name: '确认返回' }));
    expect(await screen.findByRole('button', { name: '手动填写' })).toBeVisible();

    fill.resolve({ filled: [], skipped: [], warnings: [] });
    await waitFor(() => expect(screen.queryByLabelText('商品标题')).toBeNull());
    expect(screen.queryByText('内容已填入闲鱼，请检查页面并手动发布')).toBeNull();
  });

  it('Chrome 侧栏在左侧时显示位置说明', async () => {
    render(<App services={createServices({ getPanelSide: () => Promise.resolve('left') })} />);

    expect(await screen.findByText(/侧边栏位置由 Chrome 控制/)).toBeVisible();
  });

  it('不解析链接也能创建手动草稿并持久化编辑', async () => {
    const savedTitles: string[] = [];
    render(
      <App
        services={createServices({
          saveDraft: (draft) => {
            savedTitles.push(draft.title);
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    const title = await screen.findByLabelText('商品标题');
    fireEvent.change(title, { target: { value: '用户手动输入的标题' } });

    await waitFor(() => expect(savedTitles).toContain('用户手动输入的标题'));
    expect(screen.getByText('手动输入')).toBeVisible();
    expect(screen.getByRole('button', { name: 'AI 扩写' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '填入闲鱼' })).toBeDisabled();
  });

  it('AI 扩写加载时禁用按钮，完成后直接写回表单', async () => {
    const expansion = createDeferred<{
      title: string;
      description: string;
      warnings: string[];
      factWarnings: string[];
    }>();
    render(<App services={createServices({ expandDraft: () => expansion.promise })} />);

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    const title = await screen.findByLabelText('商品标题');
    fireEvent.change(title, { target: { value: '扩写前标题' } });
    fireEvent.change(screen.getByLabelText('商品描述'), { target: { value: '扩写前描述' } });

    fireEvent.click(screen.getByRole('button', { name: 'AI 扩写' }));

    const loadingButton = screen.getByRole('button', { name: 'AI 扩写中' });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');
    expect(loadingButton.querySelector('.ai-expansion-spinner')).toHaveAttribute(
      'aria-hidden',
      'true'
    );

    expansion.resolve({
      title: '扩写后标题',
      description: '扩写后描述',
      warnings: [],
      factWarnings: []
    });

    expect(await screen.findByDisplayValue('扩写后标题')).toBeVisible();
    expect(screen.getByDisplayValue('扩写后描述')).toBeVisible();
    expect(screen.queryByText('AI 文案预览')).toBeNull();
  });

  it('手动输入负原价时不把无效数值写入草稿', async () => {
    render(<App services={createServices()} />);
    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    const originalPrice = await screen.findByLabelText('原价');

    fireEvent.change(originalPrice, { target: { value: '-1' } });

    expect(originalPrice).toHaveValue(null);
  });

  it('打开侧边栏时恢复本地草稿', async () => {
    const storedDraft = {
      id: 'stored-1',
      platform: 'generic' as const,
      canonicalUrl: '',
      source: {
        title: '',
        description: '',
        price: null,
        currency: 'CNY'
      },
      title: '已保存标题',
      description: '已保存描述',
      price: 20,
      currency: 'CNY',
      images: [],
      warnings: [],
      confidence: 'low' as const,
      shippingMethod: '包邮',
      categoryNote: '',
      updatedAt: '2026-08-31T12:00:00.000Z'
    };
    render(<App services={createServices({ loadDraft: () => Promise.resolve(storedDraft) })} />);

    expect(await screen.findByDisplayValue('已保存标题')).toBeVisible();
    expect(screen.getByText('已恢复本地草稿')).toBeVisible();
  });

  it('所有已选择图片加载完成前保持填表按钮禁用', async () => {
    const storedDraft = {
      id: 'stored-images',
      platform: 'taobao' as const,
      canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
      source: {
        title: '商品标题',
        description: '商品描述',
        price: 20,
        currency: 'CNY'
      },
      title: '商品标题',
      description: '商品描述',
      price: 20,
      currency: 'CNY',
      images: [
        {
          id: 'loaded',
          location: {
            kind: 'remote' as const,
            url: 'https://img.example.com/loaded.jpg',
            extractedBy: 'dom' as const
          },
          selected: true,
          loadStatus: 'loaded' as const
        },
        {
          id: 'pending',
          location: {
            kind: 'remote' as const,
            url: 'https://img.example.com/pending.jpg',
            extractedBy: 'dom' as const
          },
          selected: true,
          loadStatus: 'idle' as const
        }
      ],
      warnings: [],
      confidence: 'high' as const,
      shippingMethod: '包邮',
      categoryNote: '',
      updatedAt: '2026-08-31T12:00:00.000Z'
    };
    render(
      <App
        services={createServices({
          loadDraft: () => Promise.resolve(storedDraft),
          checkXianyuLogin: () => Promise.resolve({ state: 'logged-in', message: '闲鱼已登录' })
        })}
      />
    );

    expect(await screen.findByDisplayValue('商品标题')).toBeVisible();
    const fillButton = screen.getByRole('button', { name: '填入闲鱼' });
    expect(fillButton).toBeDisabled();

    fireEvent.load(screen.getByRole('img', { name: '商品图片 1' }));
    fireEvent.load(screen.getByRole('img', { name: '商品图片 2' }));

    await waitFor(() => expect(fillButton).toBeEnabled());
  });

  it('进入运行记录时刷新当前浏览器中的最新结果', async () => {
    let calls = 0;
    render(
      <App
        services={createServices({
          loadLogs: () => {
            calls += 1;
            return Promise.resolve(
              calls === 1
                ? []
                : [
                    {
                      id: 'log-new',
                      timestamp: '2026-08-31T12:00:00.000Z',
                      stage: 'parse',
                      outcome: 'success',
                      message: '最新解析已完成'
                    }
                  ]
            );
          }
        })}
      />
    );

    await screen.findByText('尚未确认闲鱼登录状态');
    fireEvent.click(screen.getByRole('button', { name: '运行记录' }));

    expect(await screen.findByText('最新解析已完成')).toBeVisible();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('无 MIME 的 MOV 视频按校验后的 MIME 保存并替换旧视频', async () => {
    const savedMimeTypes: string[] = [];
    const deleted: string[] = [];
    const storedDraft = {
      id: 'stored-video',
      platform: 'generic' as const,
      canonicalUrl: '',
      source: { title: '', description: '', price: null, currency: 'CNY' },
      title: '',
      description: '',
      price: null,
      currency: 'CNY',
      images: [],
      video: {
        id: 'local-old-video',
        assetId: 'asset-old-video',
        fileName: 'old.mp4',
        mimeType: 'video/mp4' as const,
        byteLength: 3
      },
      warnings: [],
      confidence: 'low' as const,
      shippingMethod: '包邮',
      categoryNote: '',
      updatedAt: '2026-08-31T12:00:00.000Z'
    };
    render(
      <App
        services={createServices({
          loadDraft: () => Promise.resolve(storedDraft),
          saveMedia: (file, kind) => {
            savedMimeTypes.push(file.type);
            return Promise.resolve({
              assetId: 'asset-new-video',
              kind,
              fileName: file.name,
              mimeType: file.type,
              byteLength: file.size,
              createdAt: '2026-08-31T13:00:00.000Z'
            });
          },
          deleteMedia: (assetId) => {
            deleted.push(assetId);
            return Promise.resolve();
          }
        })}
      />
    );

    await screen.findByText(/old.mp4/);
    fireEvent.change(screen.getByLabelText('上传商品视频'), {
      target: { files: [new File(['video'], 'NEW.MOV', { type: '' })] }
    });

    await waitFor(() => expect(savedMimeTypes).toEqual(['video/quicktime']));
    expect(await screen.findByText(/NEW.MOV/)).toBeVisible();
    expect(deleted).toContain('asset-old-video');
  });

  it('图片保存期间名额变满时删除已保存但不能加入的资产', async () => {
    const save = createDeferred<{
      assetId: string;
      kind: 'image';
      fileName: string;
      mimeType: string;
      byteLength: number;
      createdAt: string;
    }>();
    const deleted: string[] = [];
    const storedDraft = {
      id: 'stored-images',
      platform: 'generic' as const,
      canonicalUrl: '',
      source: { title: '', description: '', price: null, currency: 'CNY' },
      title: '',
      description: '',
      price: null,
      currency: 'CNY',
      images: Array.from({ length: 8 }, (_, index) => ({
        id: `selected-${String(index)}`,
        location: {
          kind: 'remote' as const,
          url: `https://img.example.com/${String(index)}.jpg`,
          extractedBy: 'dom' as const
        },
        selected: true,
        loadStatus: 'loaded' as const
      })).concat({
        id: 'last-slot',
        location: {
          kind: 'remote' as const,
          url: 'https://img.example.com/last.jpg',
          extractedBy: 'dom' as const
        },
        selected: false,
        loadStatus: 'loaded' as const
      }),
      warnings: [],
      confidence: 'low' as const,
      shippingMethod: '包邮',
      categoryNote: '',
      updatedAt: '2026-08-31T12:00:00.000Z'
    };
    render(
      <App
        services={createServices({
          loadDraft: () => Promise.resolve(storedDraft),
          saveMedia: () => save.promise,
          deleteMedia: (assetId) => {
            deleted.push(assetId);
            return Promise.resolve();
          }
        })}
      />
    );

    await screen.findByRole('checkbox', { name: '选择商品图片 9' });
    fireEvent.change(screen.getByLabelText('上传商品图片'), {
      target: { files: [new File(['image'], 'new.png', { type: 'image/png' })] }
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择商品图片 9' }));
    save.resolve({
      assetId: 'asset-late-image',
      kind: 'image',
      fileName: 'new.png',
      mimeType: 'image/png',
      byteLength: 5,
      createdAt: '2026-08-31T13:00:00.000Z'
    });

    await waitFor(() => expect(deleted).toContain('asset-late-image'));
    expect(screen.queryByText('new.png')).toBeNull();
  });

  it('草稿切换后删除迟到图片保存产生的资产', async () => {
    const save = createDeferred<{
      assetId: string;
      kind: 'image';
      fileName: string;
      mimeType: string;
      byteLength: number;
      createdAt: string;
    }>();
    const deleted: string[] = [];
    render(
      <App
        services={createServices({
          saveMedia: () => save.promise,
          deleteMedia: (assetId) => {
            deleted.push(assetId);
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    fireEvent.change(screen.getByLabelText('上传商品图片'), {
      target: { files: [new File(['image'], 'late.png', { type: 'image/png' })] }
    });
    fireEvent.change(screen.getByLabelText('商品链接'), { target: { value: parsedProduct.canonicalUrl } });
    fireEvent.click(screen.getByRole('button', { name: '解析商品' }));
    expect(await screen.findByDisplayValue('测试商品')).toBeVisible();

    save.resolve({
      assetId: 'asset-old-draft',
      kind: 'image',
      fileName: 'late.png',
      mimeType: 'image/png',
      byteLength: 5,
      createdAt: '2026-08-31T13:00:00.000Z'
    });

    await waitFor(() => expect(deleted).toContain('asset-old-draft'));
    expect(screen.queryByText('late.png')).toBeNull();
  });

  it('持久化含新媒体的当前草稿后以当前引用执行清理', async () => {
    const cleanupReferences: string[][] = [];
    render(
      <App
        services={createServices({
          cleanupMedia: (assetIds) => {
            cleanupReferences.push([...assetIds]);
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    fireEvent.change(screen.getByLabelText('上传商品图片'), {
      target: { files: [new File(['image'], 'persisted.png', { type: 'image/png' })] }
    });

    await waitFor(() =>
      expect(cleanupReferences.some((assetIds) => assetIds.includes('asset-persisted.png'))).toBe(true)
    );
  });

  it('两次视频替换乱序完成时只保留最后选择的视频', async () => {
    const first = createDeferred<{
      assetId: string;
      kind: 'video';
      fileName: string;
      mimeType: string;
      byteLength: number;
      createdAt: string;
    }>();
    const second = createDeferred<{
      assetId: string;
      kind: 'video';
      fileName: string;
      mimeType: string;
      byteLength: number;
      createdAt: string;
    }>();
    const saves = [first, second];
    const deleted: string[] = [];
    render(
      <App
        services={createServices({
          saveMedia: () => {
            const next = saves.shift();
            if (next === undefined) {
              throw new Error('意外的第三次保存');
            }
            return next.promise;
          },
          deleteMedia: (assetId) => {
            deleted.push(assetId);
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    const input = screen.getByLabelText('上传商品视频');
    fireEvent.change(input, { target: { files: [new File(['one'], 'first.mp4', { type: 'video/mp4' })] } });
    fireEvent.change(input, { target: { files: [new File(['two'], 'second.mp4', { type: 'video/mp4' })] } });
    second.resolve({
      assetId: 'asset-second',
      kind: 'video',
      fileName: 'second.mp4',
      mimeType: 'video/mp4',
      byteLength: 3,
      createdAt: '2026-08-31T13:00:00.000Z'
    });
    expect(await screen.findByText(/second.mp4/)).toBeVisible();
    first.resolve({
      assetId: 'asset-first',
      kind: 'video',
      fileName: 'first.mp4',
      mimeType: 'video/mp4',
      byteLength: 3,
      createdAt: '2026-08-31T13:00:00.000Z'
    });

    await waitFor(() => expect(deleted).toContain('asset-first'));
    expect(screen.queryByText(/first.mp4/)).toBeNull();
    expect(screen.getByText(/second.mp4/)).toBeVisible();
  });
});
