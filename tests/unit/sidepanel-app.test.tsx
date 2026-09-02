import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
        extractedBy: 'semantic-dom'
      },
      loadStatus: 'loaded'
    }
  ],
  videos: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  supportsPickup: false,
  categoryNote: '',
  updatedAt: '2026-08-31T12:00:00.000Z'
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface PolishOptions {
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

type TestSidePanelServices = SidePanelServices & {
  polishDescription: (
    settings: Parameters<SidePanelServices['testAiConnection']>[0],
    draft: ProductDraft,
    options: PolishOptions
  ) => Promise<{ description: string; factWarnings: string[] }>;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createServices(overrides: Partial<TestSidePanelServices> = {}): TestSidePanelServices {
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
    polishDescription: (_settings, draft, options) => {
      options.onDelta('润色后的描述');
      return Promise.resolve({ description: '润色后的描述', factWarnings: [] });
    },
    checkXianyuLogin: () => Promise.resolve({ state: 'unknown', message: '尚未确认' }),
    fillDraft: () => Promise.resolve({ filled: [], skipped: [], warnings: [] }),
    openXianyuLogin: () => Promise.resolve(),
    getPanelSide: () => Promise.resolve('right'),
    loadLogs: () => Promise.resolve([]),
    clearLogs: () => Promise.resolve(),
    ...overrides
  };
}

describe('App', () => {
  it('在插件标题后显示当前版本号', () => {
    render(<App services={createServices()} appVersion="0.1.3" />);

    expect(screen.getByText('闲鱼上架助手')).toHaveTextContent('闲鱼上架助手（v0.1.3）');
  });

  it('在商品入口明确显示淘宝、天猫和京东', () => {
    render(<App services={createServices()} />);

    expect(screen.getByText('淘宝、天猫与京东')).toBeVisible();
    expect(screen.getByPlaceholderText('粘贴淘宝、天猫或京东商品链接')).toBeVisible();
  });

  it('天猫草稿显示独立的平台来源', async () => {
    render(
      <App
        services={createServices({
          loadDraft: () =>
            Promise.resolve({
              ...readyDraft,
              platform: 'tmall',
              canonicalUrl: 'https://detail.tmall.com/item.htm?id=1'
            })
        })}
      />
    );

    expect(await screen.findByText('天猫来源')).toBeVisible();
  });

  it('无图片的完整草稿禁止填入闲鱼并说明最低图片要求', async () => {
    let submittedDraft: ProductDraft | null = null;
    render(
      <App
        services={createServices({
          checkXianyuLogin: () => Promise.resolve({ state: 'logged-in', message: '闲鱼已登录' }),
          fillDraft: (draft) => {
            submittedDraft = draft;
            return Promise.resolve({
              filled: ['title', 'price', 'description'],
              skipped: [],
              warnings: []
            });
          }
        })}
      />
    );

    await screen.findAllByText('闲鱼已登录');
    fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
    fireEvent.change(await screen.findByLabelText('商品标题'), { target: { value: '无媒体商品' } });
    fireEvent.change(screen.getByLabelText('售价'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('商品描述'), { target: { value: '仅填写文本' } });

    const fillButton = screen.getByRole('button', { name: '填入闲鱼' });
    expect(fillButton).toBeDisabled();
    expect(screen.getByText('至少添加一张已加载的商品图片后才能填入闲鱼')).toBeVisible();
    expect(submittedDraft).toBeNull();
  });

  it('使用可键盘操作的非原生发货方式下拉框', async () => {
    render(<App services={createServices()} />);

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    const combobox = screen.getByRole('combobox', { name: '发货方式' });
    expect(combobox.tagName).toBe('BUTTON');

    fireEvent.click(combobox);
    expect(screen.getByRole('listbox', { name: '发货方式' })).toBeVisible();
    expect(combobox).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(combobox).toHaveTextContent('按距离计费');
    expect(screen.queryByRole('listbox', { name: '发货方式' })).toBeNull();
  });

  it('支持配置自提，并在一口价时显示邮费金额', async () => {
    render(<App services={createServices()} />);

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '支持自提' }));
    expect(screen.getByRole('checkbox', { name: '支持自提' })).toBeChecked();

    const combobox = screen.getByRole('combobox', { name: '发货方式' });
    fireEvent.click(combobox);
    fireEvent.click(screen.getByRole('option', { name: '一口价' }));

    expect(screen.getByLabelText('邮费金额')).toBeVisible();
    fireEvent.change(screen.getByLabelText('邮费金额'), { target: { value: '12' } });
    expect(screen.getByLabelText('邮费金额')).toHaveValue(12);
  });

  // 闲鱼 Web 恢复视频上传能力后重新启用以下视频工作流用例。
  it.skip('一次上传多个视频并可分别删除', async () => {
    const deleted: string[] = [];
    render(
      <App
        services={createServices({
          deleteMedia: (assetId) => {
            deleted.push(assetId);
            return Promise.resolve();
          }
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    fireEvent.change(screen.getByLabelText('上传商品视频'), {
      target: {
        files: [
          new File(['one'], 'one.mp4', { type: 'video/mp4' }),
          new File(['two'], 'two.mov', { type: 'video/quicktime' })
        ]
      }
    });

    expect(await screen.findByText('媒体 2/9')).toBeVisible();
    expect(screen.getByText(/one\.mp4/u)).toBeVisible();
    expect(screen.getByText(/two\.mov/u)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '删除商品视频 1' }));
    await waitFor(() => expect(deleted).toContain('asset-one.mp4'));
    expect(await screen.findByText('图片 1/9')).toBeVisible();
    expect(screen.queryByText(/one\.mp4/u)).toBeNull();
    expect(screen.getByText(/two\.mov/u)).toBeVisible();
  });

  it('图片保存期间显示上传中并在完成后恢复按钮', async () => {
    const save = createDeferred<StoredMediaMetadata>();
    render(
      <App
        services={createServices({
          saveMedia: () => save.promise
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    fireEvent.change(screen.getByLabelText('上传商品图片'), {
      target: { files: [new File(['image'], 'demo.png', { type: 'image/png' })] }
    });

    expect(await screen.findByRole('button', { name: '上传中…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '上传视频' })).toBeNull();

    save.resolve({
      assetId: 'asset-demo',
      kind: 'image',
      fileName: 'demo.png',
      mimeType: 'image/png',
      byteLength: 5,
      createdAt: '2026-09-01T10:00:00.000Z'
    });

    expect(await screen.findByRole('button', { name: '上传图片' })).toBeEnabled();
  });

  it.skip('图片和视频并行上传时不会保留超出总量上限的媒体', async () => {
    const storedAssetIds = new Set<string>();
    const draftWithEightImages: ProductDraft = {
      ...readyDraft,
      id: 'eight-media-draft',
      images: Array.from({ length: 8 }, (_, index) => ({
        id: `remote-${String(index + 1)}`,
        location: {
          kind: 'remote' as const,
          url: `https://img.example.com/${String(index + 1)}.jpg`,
          extractedBy: 'semantic-dom' as const
        },
        loadStatus: 'loaded' as const
      }))
    };
    render(
      <App
        services={createServices({
          loadDraft: () => Promise.resolve(draftWithEightImages),
          saveMedia: (file, kind) => {
            const assetId = `asset-${file.name}`;
            storedAssetIds.add(assetId);
            return Promise.resolve({
              assetId,
              kind,
              fileName: file.name,
              mimeType: file.type,
              byteLength: file.size,
              createdAt: '2026-09-01T10:00:00.000Z'
            });
          },
          deleteMedia: (assetId) => {
            storedAssetIds.delete(assetId);
            return Promise.resolve();
          },
          cleanupMedia: (referencedAssetIds) => {
            const referenced = new Set(referencedAssetIds);
            for (const assetId of storedAssetIds) {
              if (!referenced.has(assetId)) {
                storedAssetIds.delete(assetId);
              }
            }
            return Promise.resolve();
          }
        })}
      />
    );

    expect(await screen.findByText('媒体 8/9')).toBeVisible();
    fireEvent.change(screen.getByLabelText('上传商品图片'), {
      target: { files: [new File(['image'], 'parallel.png', { type: 'image/png' })] }
    });
    const videoInput = screen.getByLabelText('上传商品视频');
    expect(videoInput).toBeEnabled();
    fireEvent.change(videoInput, {
      target: { files: [new File(['video'], 'parallel.mp4', { type: 'video/mp4' })] }
    });

    expect(await screen.findByText('媒体 9/9')).toBeVisible();
    await waitFor(() => expect(storedAssetIds.size).toBe(1));
  });

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

    expect(
      await screen.findByText('检查闲鱼登录状态失败：扩展后台返回了无法识别的登录状态')
    ).toBeVisible();
    expect(screen.getByText('尚未确认闲鱼登录状态')).toBeVisible();
  });

  it('未登录时显示提醒且禁用填表动作', async () => {
    render(
      <App
        services={createServices({
          checkXianyuLogin: () =>
            Promise.resolve({
              state: 'logged-out',
              message: '请先完成闲鱼网页登录，草稿会保留在本地。'
            })
        })}
      />
    );

    expect(await screen.findByText('需要登录闲鱼')).toBeVisible();
    expect(screen.getByRole('button', { name: '填入闲鱼' })).toBeDisabled();
  });

  it('在商品链接输入处提醒先登录对应平台', () => {
    render(<App services={createServices()} />);

    const sourceInput = screen.getByLabelText('商品链接');
    expect(screen.getByText('解析前请先登录对应平台')).toBeVisible();
    expect(sourceInput).toHaveAccessibleDescription('解析前请先登录对应平台');
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

  it('把售价和商品图缺失警告显示在对应字段附近', async () => {
    const priceWarning = '未能可靠识别售价，请手动填写';
    const imageWarning = '未能可靠识别商品图片，请手动补充';
    render(
      <App
        services={createServices({
          parseProduct: () =>
            Promise.resolve({
              ...parsedProduct,
              warnings: [priceWarning, imageWarning]
            })
        })}
      />
    );
    fireEvent.change(screen.getByLabelText('商品链接'), {
      target: { value: parsedProduct.canonicalUrl }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析商品' }));

    await screen.findByDisplayValue('测试商品');
    expect(
      screen.getAllByText(priceWarning).some((element) => element.getAttribute('role') === 'status')
    ).toBe(true);
    expect(
      screen.getAllByText(imageWarning).some((element) => element.getAttribute('role') === 'status')
    ).toBe(true);
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
    expect(await screen.findByText('图片 1/9')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认返回' }));

    expect(await screen.findByText('草稿已更新，请重新确认返回')).toBeVisible();
    expect(cleared).toBe(0);
    expect(screen.getByText('图片 1/9')).toBeVisible();
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
    expect(screen.getByRole('button', { name: 'AI 润色' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '填入闲鱼' })).toBeDisabled();
  });

  it('AI 润色先清空描述再流式显示，生成完成后保留标题并显示恢复按钮', async () => {
    const completion = createDeferred<{ description: string; factWarnings: string[] }>();
    const optionsReady = createDeferred<PolishOptions>();
    render(
      <App
        services={createServices({
          polishDescription: (_settings, _draft, nextOptions) => {
            optionsReady.resolve(nextOptions);
            return completion.promise;
          }
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    const title = await screen.findByLabelText('商品标题');
    fireEvent.change(title, { target: { value: '润色前标题' } });
    const description = screen.getByLabelText('商品描述');
    fireEvent.change(description, { target: { value: '润色前描述' } });

    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));

    expect(screen.getByRole('button', { name: '停止润色' })).toBeEnabled();
    expect(description).toHaveValue('');
    expect(description).toHaveAttribute('readonly');
    expect(screen.getByRole('status', { name: 'AI 正在润色商品描述' })).toHaveTextContent(
      '等待 AI 响应…'
    );
    expect(screen.queryByRole('button', { name: '恢复' })).toBeNull();

    const options = await optionsReady.promise;
    act(() => {
      options.onDelta('第一段\n\n第二段');
    });
    expect(description).toHaveValue('第');
    expect(screen.getByRole('status', { name: 'AI 正在润色商品描述' })).toHaveTextContent(
      '正在生成…'
    );
    await waitFor(() => expect(description).toHaveValue('第一段\n第二段'));

    completion.resolve({ description: '第一段\n第二段', factWarnings: ['仅写入运行记录'] });

    expect(await screen.findByRole('button', { name: '恢复' })).toBeVisible();
    expect(screen.getByLabelText('商品标题')).toHaveValue('润色前标题');
    expect(screen.getByLabelText('商品描述')).toHaveValue('第一段\n第二段');
    expect(screen.getByRole('button', { name: 'AI 润色' })).toBeEnabled();
    expect(screen.queryByRole('status', { name: 'AI 正在润色商品描述' })).toBeNull();
    expect(screen.queryByText('仅写入运行记录')).toBeNull();
  });

  it('生成中点击停止会取消请求并恢复初始商品描述', async () => {
    let signal: AbortSignal | null = null;
    render(
      <App
        services={createServices({
          polishDescription: (_settings, _draft, options) => {
            signal = options.signal;
            options.onDelta('尚未完成');
            return new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            });
          }
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    const description = screen.getByLabelText('商品描述');
    fireEvent.change(description, { target: { value: '需要保留的原描述' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));

    expect(description).toHaveValue('尚');
    fireEvent.click(screen.getByRole('button', { name: '停止润色' }));

    expect(signal).not.toBeNull();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(description).toHaveValue('需要保留的原描述');
    expect(screen.queryByRole('button', { name: '恢复' })).toBeNull();
  });

  it('完成润色后经二次确认恢复初始描述，取消确认时保留生成内容', async () => {
    render(<App services={createServices()} />);
    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    const description = screen.getByLabelText('商品描述');
    fireEvent.change(description, { target: { value: '最初的商品描述' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));

    const restoreButton = await screen.findByRole('button', { name: '恢复' });
    expect(description).toHaveValue('润色后的描述');
    fireEvent.click(restoreButton);
    expect(screen.getByRole('dialog', { name: '恢复初始描述' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(description).toHaveValue('润色后的描述');
    expect(restoreButton).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));

    expect(description).toHaveValue('最初的商品描述');
    expect(screen.queryByRole('button', { name: '恢复' })).toBeNull();
    expect(screen.getByRole('button', { name: 'AI 润色' })).toHaveFocus();
  });

  it('润色失败后重试成功会清除旧错误并保留初始恢复基线', async () => {
    let attempts = 0;
    render(
      <App
        services={createServices({
          polishDescription: (_settings, _draft, options) => {
            attempts += 1;
            if (attempts === 1) {
              return Promise.reject(new Error('第一次润色失败'));
            }
            const description = attempts === 2 ? '第一次成功结果' : '第二次成功结果';
            options.onDelta(description);
            return Promise.resolve({ description, factWarnings: [] });
          }
        })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '手动填写' }));
    const description = screen.getByLabelText('商品描述');
    fireEvent.change(description, { target: { value: '首次润色前的描述' } });

    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));
    expect(await screen.findByText('第一次润色失败')).toBeVisible();
    expect(description).toHaveValue('首次润色前的描述');

    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));
    expect(await screen.findByDisplayValue('第一次成功结果')).toBeVisible();
    expect(screen.queryByText('第一次润色失败')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));
    expect(await screen.findByDisplayValue('第二次成功结果')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(description).toHaveValue('首次润色前的描述');
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
      videos: [],
      warnings: [],
      confidence: 'low' as const,
      shippingMethod: '包邮' as const,
      supportsPickup: false,
      categoryNote: '',
      updatedAt: '2026-08-31T12:00:00.000Z'
    };
    render(<App services={createServices({ loadDraft: () => Promise.resolve(storedDraft) })} />);

    expect(await screen.findByDisplayValue('已保存标题')).toBeVisible();
    expect(screen.getByText('已恢复本地草稿')).toBeVisible();
  });

  it('草稿中的图片全部加载完成前保持填表按钮禁用', async () => {
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
            extractedBy: 'semantic-dom' as const
          },
          loadStatus: 'loaded' as const
        },
        {
          id: 'pending',
          location: {
            kind: 'remote' as const,
            url: 'https://img.example.com/pending.jpg',
            extractedBy: 'semantic-dom' as const
          },
          loadStatus: 'idle' as const
        }
      ],
      videos: [],
      warnings: [],
      confidence: 'high' as const,
      shippingMethod: '包邮' as const,
      supportsPickup: false,
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

  it('确认删除运行记录后清空本地记录和当前列表', async () => {
    const clearLogs = vi.fn(() => Promise.resolve());
    const services = {
      ...createServices({
        loadLogs: () =>
          Promise.resolve([
            {
              id: 'log-delete',
              timestamp: '2026-09-02T14:00:00.000Z',
              stage: 'ai' as const,
              outcome: 'failure' as const,
              message: '待删除记录'
            }
          ])
      }),
      clearLogs
    };
    render(<App services={services} />);

    fireEvent.click(screen.getByRole('button', { name: '运行记录' }));
    expect(await screen.findByText('待删除记录')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }));
    expect(screen.getByRole('dialog', { name: '删除运行记录' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(clearLogs).toHaveBeenCalledTimes(1));
    expect(screen.getByText('尚无运行记录。')).toBeVisible();
  });

  it.skip('无 MIME 的 MOV 视频按校验后的 MIME 保存并追加到旧视频', async () => {
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
      videos: [
        {
          id: 'local-old-video',
          assetId: 'asset-old-video',
          fileName: 'old.mp4',
          mimeType: 'video/mp4' as const,
          byteLength: 3
        }
      ],
      warnings: [],
      confidence: 'low' as const,
      shippingMethod: '包邮' as const,
      supportsPickup: false,
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
    expect(deleted).not.toContain('asset-old-video');
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
    fireEvent.change(screen.getByLabelText('商品链接'), {
      target: { value: parsedProduct.canonicalUrl }
    });
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
      expect(cleanupReferences.some((assetIds) => assetIds.includes('asset-persisted.png'))).toBe(
        true
      )
    );
  });

  it.skip('两次视频上传乱序完成时丢弃已失效请求的文件', async () => {
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
    fireEvent.change(input, {
      target: { files: [new File(['one'], 'first.mp4', { type: 'video/mp4' })] }
    });
    fireEvent.change(input, {
      target: { files: [new File(['two'], 'second.mp4', { type: 'video/mp4' })] }
    });
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
