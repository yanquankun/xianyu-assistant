import { describe, expect, it } from 'vitest';

import type { ProductDraft } from '../../src/domain/product';
import type { AiSettings } from '../../src/domain/settings';
import { createLocalStore, type StorageAreaLike } from '../../src/storage/local-store';

class MemoryStorageArea implements StorageAreaLike {
  readonly data: Record<string, unknown> = {};
  accessLevel: string | undefined;

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(
      Object.fromEntries(requested.filter((key) => key in this.data).map((key) => [key, this.data[key]]))
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
    return Promise.resolve();
  }

  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void> {
    this.accessLevel = options.accessLevel;
    return Promise.resolve();
  }
}

const settings: AiSettings = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret-key',
  model: 'gpt-test',
  temperature: 0.3,
  systemInstruction: ''
};

const draft: ProductDraft = {
  id: 'draft-1',
  platform: 'jd',
  canonicalUrl: 'https://item.jd.com/1.html',
  source: {
    title: '来源标题',
    description: '来源描述',
    price: 99.9,
    currency: 'CNY'
  },
  title: '编辑标题',
  description: '编辑描述',
  price: 88,
  currency: 'CNY',
  images: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '',
  updatedAt: '2026-08-31T10:00:00.000Z'
};

describe('createLocalStore', () => {
  it('把扩展本地存储限制为可信上下文', async () => {
    const area = new MemoryStorageArea();
    const store = createLocalStore(area);

    await store.initialize();

    expect(area.accessLevel).toBe('TRUSTED_CONTEXTS');
  });

  it('保存并读取 OpenAI 兼容设置', async () => {
    const store = createLocalStore(new MemoryStorageArea());

    await store.saveSettings(settings);

    await expect(store.getSettings()).resolves.toEqual(settings);
  });

  it('保存草稿时返回独立数据，调用方修改不会污染存储', async () => {
    const store = createLocalStore(new MemoryStorageArea());
    await store.saveDraft(draft);

    const loaded = await store.getDraft();
    expect(loaded).not.toBeNull();
    if (loaded === null) {
      throw new Error('测试需要读取已保存草稿');
    }
    loaded.title = '调用方修改';

    await expect(store.getDraft()).resolves.toMatchObject({ title: '编辑标题' });
  });

  it('存储中没有值时返回安全默认值', async () => {
    const store = createLocalStore(new MemoryStorageArea());

    await expect(store.getSettings()).resolves.toBeNull();
    await expect(store.getDraft()).resolves.toBeNull();
  });
});
