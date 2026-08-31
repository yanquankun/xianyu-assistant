import { describe, expect, it } from 'vitest';

import type { MediaStore, StoredMediaAsset } from '../../src/storage/media-store';
import {
  MEDIA_TRANSFER_CHUNK_BYTES,
  createMediaTransferRegistry,
  isMediaTransferDescriptor,
  isTrustedMediaTransferSender,
  receiveMediaFile,
  type MediaTransferClientPort,
  type MediaTransferClientRequest,
  type MediaTransferServerResponse
} from '../../src/xianyu/media-transfer';

function videoAsset(bytes: Uint8Array): StoredMediaAsset {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return {
    assetId: 'asset-video',
    kind: 'video',
    fileName: 'demo.mp4',
    mimeType: 'video/mp4',
    byteLength: bytes.byteLength,
    createdAt: '2026-08-31T13:00:00.000Z',
    blob: new Blob([buffer], { type: 'video/mp4' })
  };
}

function mediaStore(asset: StoredMediaAsset | null): Pick<MediaStore, 'get'> {
  return { get: () => Promise.resolve(asset) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

describe('MediaTransferRegistry', () => {
  it('会话只允许绑定标签页按顺序读取并在完成后释放', async () => {
    const bytes = new Uint8Array(MEDIA_TRANSFER_CHUNK_BYTES + 3);
    bytes.set([1, 2, 3], MEDIA_TRANSFER_CHUNK_BYTES);
    const registry = createMediaTransferRegistry(
      mediaStore(videoAsset(bytes)),
      () => 1_000,
      () => 'session-1'
    );
    const descriptor = await registry.create('asset-video', 42);

    await expect(registry.read(descriptor.sessionId, 99, 0)).rejects.toThrow('媒体传输目标不匹配');
    const first = await registry.read(descriptor.sessionId, 42, 0);
    expect(first.offset).toBe(0);
    expect(atob(first.dataBase64)).toHaveLength(MEDIA_TRANSFER_CHUNK_BYTES);
    expect(first.done).toBe(false);
    await expect(registry.read(descriptor.sessionId, 42, 0)).rejects.toThrow('媒体传输偏移不连续');

    const second = await registry.read(descriptor.sessionId, 42, MEDIA_TRANSFER_CHUNK_BYTES);
    expect(Array.from(atob(second.dataBase64), (value) => value.charCodeAt(0))).toEqual([1, 2, 3]);
    expect(second.done).toBe(true);
    await expect(registry.read(descriptor.sessionId, 42, bytes.byteLength)).rejects.toThrow(
      '媒体传输会话不存在'
    );
  });

  it('显式关闭释放会话且跨标签页不能关闭', async () => {
    const registry = createMediaTransferRegistry(
      mediaStore(videoAsset(new Uint8Array([1, 2, 3]))),
      () => 1_000,
      () => 'session-1'
    );
    const descriptor = await registry.create('asset-video', 42);

    await expect(registry.release(descriptor.sessionId, 99)).rejects.toThrow('媒体传输目标不匹配');
    await registry.release(descriptor.sessionId, 42);
    await expect(registry.read(descriptor.sessionId, 42, 0)).rejects.toThrow('媒体传输会话不存在');
  });

  it('目标标签页关闭时释放该标签页的全部会话', async () => {
    const registry = createMediaTransferRegistry(
      mediaStore(videoAsset(new Uint8Array([1, 2, 3]))),
      () => 1_000,
      () => 'session-1'
    );
    const descriptor = await registry.create('asset-video', 42);

    registry.releaseForTab(42);

    await expect(registry.read(descriptor.sessionId, 42, 0)).rejects.toThrow('媒体传输会话不存在');
  });

  it('拒绝未知、过期会话和无效 offset', async () => {
    let now = 1_000;
    const registry = createMediaTransferRegistry(
      mediaStore(videoAsset(new Uint8Array([1, 2, 3]))),
      () => now,
      () => 'session-1'
    );
    const descriptor = await registry.create('asset-video', 42);

    await expect(registry.read('unknown', 42, 0)).rejects.toThrow('媒体传输会话不存在');
    await expect(registry.read(descriptor.sessionId, 42, -1)).rejects.toThrow('媒体传输偏移无效');
    now += 61_000;
    await expect(registry.read(descriptor.sessionId, 42, 0)).rejects.toThrow('媒体传输会话已过期');
    await expect(registry.read(descriptor.sessionId, 42, 0)).rejects.toThrow('媒体传输会话不存在');
  });

  it('创建时拒绝缺失、错误 MIME 和超过 100 MB 的视频', async () => {
    await expect(
      createMediaTransferRegistry(mediaStore(null)).create('asset-video', 42)
    ).rejects.toThrow('本地视频不存在或已被删除');

    const wrongMime = { ...videoAsset(new Uint8Array([1])), mimeType: 'video/webm' };
    await expect(
      createMediaTransferRegistry(mediaStore(wrongMime)).create('asset-video', 42)
    ).rejects.toThrow('视频类型不受支持');

    const oversizedBlob = new Blob([new Uint8Array([1])], { type: 'video/mp4' });
    Object.defineProperty(oversizedBlob, 'size', { value: 100 * 1024 * 1024 + 1 });
    const oversized = {
      ...videoAsset(new Uint8Array([1])),
      byteLength: 100 * 1024 * 1024 + 1,
      blob: oversizedBlob
    };
    await expect(
      createMediaTransferRegistry(mediaStore(oversized)).create('asset-video', 42)
    ).rejects.toThrow('视频超过 100 MB 上限');
  });
});

describe('媒体传输消息边界', () => {
  it('descriptor 固定 512 KB 分块并拒绝超限、错误 MIME 和多余字段', () => {
    const descriptor = {
      sessionId: 'session-1',
      fileName: 'demo.mp4',
      mimeType: 'video/mp4',
      byteLength: 10,
      chunkBytes: MEDIA_TRANSFER_CHUNK_BYTES
    };

    expect(isMediaTransferDescriptor(descriptor)).toBe(true);
    expect(
      isMediaTransferDescriptor({ ...descriptor, chunkBytes: MEDIA_TRANSFER_CHUNK_BYTES + 1 })
    ).toBe(false);
    expect(isMediaTransferDescriptor({ ...descriptor, mimeType: 'video/webm' })).toBe(false);
    expect(isMediaTransferDescriptor({ ...descriptor, assetId: '不可暴露' })).toBe(false);
  });

  it.each([
    [{ id: 'other', tab: { id: 42 }, url: 'https://www.goofish.com/publish' }, 'extension-id'],
    [{ id: 'extension-id', tab: { id: 42 }, url: 'https://evil.example/publish' }, 'extension-id'],
    [
      { id: 'extension-id', tab: { id: 42 }, url: 'http://www.goofish.com/publish' },
      'extension-id'
    ],
    [
      { id: 'extension-id', tab: { id: 42 }, url: 'https://sub.www.goofish.com/publish' },
      'extension-id'
    ],
    [{ id: 'extension-id', url: 'https://www.goofish.com/publish' }, 'extension-id']
  ])('拒绝错误 sender ID、URL 或缺失目标标签页：%j', (sender, extensionId) => {
    expect(isTrustedMediaTransferSender(sender, extensionId)).toBeNull();
  });

  it('只接受扩展自身在 www.goofish.com 的标签页 sender', () => {
    expect(
      isTrustedMediaTransferSender(
        { id: 'extension-id', tab: { id: 42 }, url: 'https://www.goofish.com/publish' },
        'extension-id'
      )
    ).toBe(42);
  });
});

type ReadRequest = Extract<MediaTransferClientRequest, { type: 'READ' }>;

class FakeClientPort implements MediaTransferClientPort {
  readonly requests: MediaTransferClientRequest[] = [];
  disconnected = false;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  constructor(private readonly respond: (request: ReadRequest) => MediaTransferServerResponse) {}

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => this.messageListeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => this.messageListeners.delete(listener)
  };

  readonly onDisconnect = {
    addListener: (listener: () => void) => this.disconnectListeners.add(listener),
    removeListener: (listener: () => void) => this.disconnectListeners.delete(listener)
  };

  postMessage(message: MediaTransferClientRequest): void {
    this.requests.push(message);
    if (message.type === 'READ') {
      const response = this.respond(message);
      queueMicrotask(() => {
        for (const listener of this.messageListeners) {
          listener(response);
        }
      });
    }
  }

  disconnect(): void {
    this.disconnected = true;
    for (const listener of this.disconnectListeners) {
      listener();
    }
  }
}

describe('receiveMediaFile', () => {
  it('一次只请求一个 512 KB 分块并在成功后 CLOSE 与 disconnect', async () => {
    const first = new Uint8Array(MEDIA_TRANSFER_CHUNK_BYTES).fill(1);
    const second = new Uint8Array([2, 3, 4]);
    const responses = [first, second];
    let responseIndex = 0;
    const port = new FakeClientPort((request) => {
      const bytes = responses[responseIndex++];
      if (bytes === undefined) {
        throw new Error('测试响应耗尽');
      }
      return {
        type: 'CHUNK',
        chunk: {
          sessionId: request.sessionId,
          offset: request.offset,
          dataBase64: bytesToBase64(bytes),
          done: responseIndex === responses.length
        }
      };
    });
    const descriptor = {
      sessionId: 'session-1',
      fileName: 'demo.mp4',
      mimeType: 'video/mp4' as const,
      byteLength: first.byteLength + second.byteLength,
      chunkBytes: MEDIA_TRANSFER_CHUNK_BYTES
    };

    const file = await receiveMediaFile(descriptor, () => port);

    expect(file.name).toBe('demo.mp4');
    expect(file.size).toBe(descriptor.byteLength);
    expect(port.requests).toEqual([
      { type: 'READ', sessionId: 'session-1', offset: 0 },
      { type: 'READ', sessionId: 'session-1', offset: MEDIA_TRANSFER_CHUNK_BYTES },
      { type: 'CLOSE', sessionId: 'session-1' }
    ]);
    expect(port.disconnected).toBe(true);
  });

  it('错误响应时仍在 finally 中 CLOSE 与 disconnect', async () => {
    const port = new FakeClientPort((request) => ({
      type: 'ERROR',
      sessionId: request.sessionId,
      message: '媒体传输目标不匹配'
    }));
    const descriptor = {
      sessionId: 'session-1',
      fileName: 'demo.mp4',
      mimeType: 'video/mp4' as const,
      byteLength: 3,
      chunkBytes: MEDIA_TRANSFER_CHUNK_BYTES
    };

    await expect(receiveMediaFile(descriptor, () => port)).rejects.toThrow('媒体传输目标不匹配');
    expect(port.requests.at(-1)).toEqual({ type: 'CLOSE', sessionId: 'session-1' });
    expect(port.disconnected).toBe(true);
  });
});
