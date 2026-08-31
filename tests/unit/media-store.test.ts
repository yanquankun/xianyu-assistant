import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import { createMediaStore } from '../../src/storage/media-store';

interface RawMediaRecord {
  assetId: string;
  kind: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
  blob: object;
}

interface ControlledTransaction {
  onabort: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  oncomplete: ((event: Event) => unknown) | null;
  objectStore(name: string): IDBObjectStore;
  abort(): void;
}

function createTestFile(contents: string[], name: string, type: string): File {
  const blob = new NodeBlob(contents, { type });
  Object.defineProperties(blob, {
    lastModified: { value: 0 },
    name: { value: name },
    webkitRelativePath: { value: '' }
  });
  // fake-indexeddb 可可靠克隆 Node 原生 Blob；happy-dom File 会被克隆为普通对象。
  return blob as unknown as File;
}

function openExistingDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('xianyu-assistant-media', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('测试无法打开 IndexedDB'));
  });
}

async function writeRawRecord(factory: IDBFactory, record: RawMediaRecord): Promise<void> {
  const database = await openExistingDatabase(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('assets', 'readwrite');
      const request = transaction.objectStore('assets').put(record);
      request.onerror = () => reject(new Error('测试无法写入损坏记录'));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error('测试写入损坏记录被中止'));
    });
  } finally {
    database.close();
  }
}

function createValidRawRecord(assetId: string): RawMediaRecord {
  const blob = new NodeBlob(['image'], { type: 'image/png' });
  return {
    assetId,
    kind: 'image',
    fileName: 'valid.png',
    mimeType: 'image/png',
    byteLength: blob.size,
    createdAt: '2026-08-31T00:00:00.000Z',
    blob
  };
}

function createControlledFailureFactory(
  failure: 'write-abort' | 'read-request-error'
): { factory: IDBFactory; wasClosed(): boolean } {
  let closed = false;
  const controlledRequest = {
    onerror: null as ((event: Event) => unknown) | null,
    onsuccess: null as ((event: Event) => unknown) | null
  } as unknown as IDBRequest<undefined>;
  const controlledTransaction: ControlledTransaction = {
    onabort: null,
    onerror: null,
    oncomplete: null,
    objectStore: () =>
      ({
        add: () => controlledRequest,
        get: () => {
          queueMicrotask(() => {
            controlledRequest.onerror?.call(controlledRequest, new Event('error'));
          });
          return controlledRequest;
        }
      }) as unknown as IDBObjectStore,
    abort: () => {
      queueMicrotask(() => {
        controlledTransaction.onabort?.(new Event('abort'));
      });
    }
  };
  const database = {
    transaction: () => {
      if (failure === 'write-abort') {
        queueMicrotask(() => controlledTransaction.abort());
      }
      return controlledTransaction as unknown as IDBTransaction;
    },
    close: () => {
      closed = true;
    }
  } as unknown as IDBDatabase;
  const openRequest = {
    result: database,
    onblocked: null as ((event: Event) => unknown) | null,
    onerror: null as ((event: Event) => unknown) | null,
    onsuccess: null as ((event: Event) => unknown) | null,
    onupgradeneeded: null as ((event: Event) => unknown) | null
  } as unknown as IDBOpenDBRequest;
  const factory = new IDBFactory();
  Object.defineProperty(factory, 'open', {
    value: (): IDBOpenDBRequest => {
      queueMicrotask(() => {
        openRequest.onsuccess?.call(openRequest, new Event('success'));
      });
      return openRequest;
    }
  });

  return { factory, wasClosed: () => closed };
}

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
      createTestFile(['image'], 'a.png', 'image/png'),
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
    const first = await store.save(createTestFile(['one'], 'one.png', 'image/png'), 'image');
    const second = await store.save(createTestFile(['two'], 'two.mp4', 'video/mp4'), 'video');
    const third = await store.save(createTestFile(['three'], 'three.webp', 'image/webp'), 'image');

    await store.deleteMany([first.assetId, second.assetId]);
    await store.cleanupExcept(new Set([third.assetId]));

    await expect(store.get(first.assetId)).resolves.toBeNull();
    await expect(store.get(second.assetId)).resolves.toBeNull();
    await expect(store.get(third.assetId)).resolves.toMatchObject({ assetId: third.assetId });
  });

  it('打开 IndexedDB 失败时向调用方返回中文安全错误', async () => {
    const store = createMediaStore(createOpenFailureFactory(), () => 'asset-1');

    await expect(store.save(createTestFile(['image'], 'a.png', 'image/png'), 'image')).rejects.toThrow(
      '本地媒体保存失败'
    );
    await expect(store.get('asset-1')).rejects.toThrow('本地媒体读取失败');
  });

  it('损坏的 Blob 或关键元数据不会冒充本地媒体资产', async () => {
    const factory = new IDBFactory();
    const store = createMediaStore(factory, () => 'valid-asset');
    await store.save(createTestFile(['image'], 'valid.png', 'image/png'), 'image');

    const invalidRecords: RawMediaRecord[] = [
      { ...createValidRawRecord('invalid-blob'), blob: {} },
      { ...createValidRawRecord('invalid-byte-length'), byteLength: Number.NaN },
      { ...createValidRawRecord('invalid-byte-mismatch'), byteLength: 0 },
      { ...createValidRawRecord('invalid-kind'), kind: 'document' },
      { ...createValidRawRecord('invalid-file-name'), fileName: ' ' },
      { ...createValidRawRecord('invalid-mime-type'), mimeType: '' },
      { ...createValidRawRecord('invalid-created-at'), createdAt: 'not-a-date' }
    ];

    for (const record of invalidRecords) {
      await writeRawRecord(factory, record);
      await expect(store.get(record.assetId)).resolves.toBeNull();
    }
  });

  it('写事务中止时以中文安全错误拒绝并关闭连接', async () => {
    const controlled = createControlledFailureFactory('write-abort');
    const store = createMediaStore(controlled.factory, () => 'asset-1');

    await expect(store.save(createTestFile(['image'], 'a.png', 'image/png'), 'image')).rejects.toThrow(
      '本地媒体保存失败'
    );
    expect(controlled.wasClosed()).toBe(true);
  });

  it('读请求失败时以中文安全错误拒绝并关闭连接', async () => {
    const controlled = createControlledFailureFactory('read-request-error');
    const store = createMediaStore(controlled.factory, () => 'asset-1');

    await expect(store.get('asset-1')).rejects.toThrow('本地媒体读取失败');
    expect(controlled.wasClosed()).toBe(true);
  }, 500);
});
