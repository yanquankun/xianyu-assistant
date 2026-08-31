import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { createMediaStore } from '../../src/storage/media-store';

function createOpenFailureFactory(): IDBFactory {
  const factory = new IDBFactory();
  Object.defineProperty(factory, 'open', {
    value: (): IDBOpenDBRequest => {
      const request = new IDBFactory().open('failing-media-store');
      queueMicrotask(() => {
        request.onerror?.call(request, new Event('error'));
      });
      return request;
    }
  });
  return factory;
}

describe('MediaStore', () => {
  it('保存 Blob 后可按 assetId 读取并删除', async () => {
    const store = createMediaStore(new IDBFactory(), () => 'asset-1');
    const metadata = await store.save(
      new File(['image'], 'a.png', { type: 'image/png' }),
      'image'
    );

    expect(metadata).toMatchObject({
      assetId: 'asset-1',
      fileName: 'a.png',
      kind: 'image',
      mimeType: 'image/png',
      byteLength: 5
    });
    await expect(store.get(metadata.assetId)).resolves.toMatchObject({
      assetId: 'asset-1',
      fileName: 'a.png',
      kind: 'image'
    });

    await store.delete(metadata.assetId);
    await expect(store.get(metadata.assetId)).resolves.toBeNull();
  });

  it('批量删除和孤立清理只操作扩展自己的 assets 仓库', async () => {
    let nextId = 0;
    const factory = new IDBFactory();
    const store = createMediaStore(factory, () => `asset-${String(++nextId)}`);
    const first = await store.save(new File(['one'], 'one.png', { type: 'image/png' }), 'image');
    const second = await store.save(new File(['two'], 'two.mp4', { type: 'video/mp4' }), 'video');
    const third = await store.save(new File(['three'], 'three.webp', { type: 'image/webp' }), 'image');

    await store.deleteMany([first.assetId, second.assetId]);
    await store.cleanupExcept(new Set([third.assetId]));

    await expect(store.get(first.assetId)).resolves.toBeNull();
    await expect(store.get(second.assetId)).resolves.toBeNull();
    await expect(store.get(third.assetId)).resolves.toMatchObject({ assetId: third.assetId });
  });

  it('打开 IndexedDB 失败时向调用方返回中文安全错误', async () => {
    const store = createMediaStore(createOpenFailureFactory(), () => 'asset-1');

    await expect(store.save(new File(['image'], 'a.png', { type: 'image/png' }), 'image')).rejects.toThrow(
      '本地媒体保存失败'
    );
    await expect(store.get('asset-1')).rejects.toThrow('本地媒体读取失败');
  });
});
