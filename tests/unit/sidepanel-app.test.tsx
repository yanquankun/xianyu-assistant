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
    render(<App services={createServices({ checkXianyuLogin: () => Promise.resolve('logged-out') })} />);

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
});
