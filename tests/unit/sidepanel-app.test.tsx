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

function createServices(overrides: Partial<SidePanelServices> = {}): SidePanelServices {
  return {
    loadSettings: () => Promise.resolve(null),
    saveSettings: () => Promise.resolve(),
    loadDraft: () => Promise.resolve(null),
    saveDraft: () => Promise.resolve(),
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
});
