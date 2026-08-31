import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ParsedProduct } from '../../src/domain/product';
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
    checkXianyuLogin: () => Promise.resolve('unknown'),
    fillDraft: () => Promise.resolve({ filled: [], skipped: [], warnings: [] }),
    openXianyuLogin: () => Promise.resolve(),
    getPanelSide: () => Promise.resolve('right'),
    loadLogs: () => Promise.resolve([]),
    ...overrides
  };
}

describe('App', () => {
  it('未登录时显示提醒且禁用填表动作', async () => {
    render(
      <App services={createServices({ checkXianyuLogin: () => Promise.resolve('logged-out') })} />
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
    expect(screen.getByText('高')).toBeVisible();
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
          checkXianyuLogin: () => Promise.resolve('logged-in')
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
