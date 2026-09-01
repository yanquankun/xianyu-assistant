import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ProductImage } from '../../src/domain/product';
import type { MediaStore } from '../../src/storage/media-store';
import {
  downloadImages,
  fillXianyuDraft,
  isXianyuFillPayload,
  parseXianyuFillResult,
  prepareImages,
  type ImageFetchLike,
  type XianyuFillPayload
} from '../../src/xianyu/fill';

function publishDocument(): Document {
  const html = readFileSync(
    resolve(process.cwd(), 'tests', 'fixtures', 'xianyu-publish.html'),
    'utf8'
  );
  return new DOMParser().parseFromString(html, 'text/html');
}

const validPayload: XianyuFillPayload = {
  title: '测试发布标题',
  description: '测试发布描述',
  price: 88.5,
  shippingMethod: '包邮',
  categoryNote: '',
  images: [
    {
      id: 'image-1',
      name: 'image-1.png',
      mimeType: 'image/png',
      dataBase64: 'aGVsbG8='
    }
  ]
};

describe('fillXianyuDraft', () => {
  it('没有图片和视频时仍填写文本且不把媒体记为跳过', async () => {
    const result = await fillXianyuDraft(publishDocument(), { ...validPayload, images: [] }, []);

    expect(result.filled).toEqual(expect.arrayContaining(['title', 'price', 'description']));
    expect(result.skipped).toEqual([]);
  });

  it('一次把多个视频写入视频文件输入框', async () => {
    const document = publishDocument();
    const first = new File(['one'], 'one.mp4', { type: 'video/mp4' });
    const second = new File(['two'], 'two.mov', { type: 'video/quicktime' });

    const result = await fillXianyuDraft(document, validPayload, [first, second]);

    expect(
      Array.from(document.querySelector<HTMLInputElement>('input[name="video"]')?.files ?? []).map(
        (file) => file.name
      )
    ).toEqual(['one.mp4', 'two.mov']);
    expect(result.filled).toContain('video');
  });

  it('填表消息按图片和视频合计九个媒体校验', () => {
    const videoTransfer = {
      sessionId: 'session-1',
      fileName: 'demo.mp4',
      mimeType: 'video/mp4' as const,
      byteLength: 5,
      chunkBytes: 512 * 1024
    };

    expect(
      isXianyuFillPayload({
        ...validPayload,
        images: new Array(8).fill(validPayload.images[0]),
        videoTransfers: [videoTransfer]
      })
    ).toBe(true);
    expect(
      isXianyuFillPayload({
        ...validPayload,
        images: new Array(9).fill(validPayload.images[0]),
        videoTransfers: [videoTransfer]
      })
    ).toBe(false);
  });

  it('严格校验跨上下文填表消息边界', () => {
    expect(isXianyuFillPayload(validPayload)).toBe(true);
    expect(isXianyuFillPayload({ ...validPayload, price: Number.NaN })).toBe(false);
    expect(isXianyuFillPayload({ ...validPayload, originalPrice: -1 })).toBe(false);
    expect(
      isXianyuFillPayload({
        ...validPayload,
        images: new Array(10).fill(validPayload.images[0])
      })
    ).toBe(false);
    expect(isXianyuFillPayload({ ...validPayload, videoDataBase64: '整文件视频' })).toBe(false);
    expect(
      isXianyuFillPayload({
        ...validPayload,
        videoTransfer: {
          sessionId: 'session-1',
          fileName: 'demo.mp4',
          mimeType: 'video/mp4',
          byteLength: 5,
          chunkBytes: 512 * 1024,
          dataBase64: '禁止放入 descriptor'
        }
      })
    ).toBe(false);
  });

  it('填写标题、价格、描述和图片后不触发发布按钮', async () => {
    const document = publishDocument();
    const publish = document.querySelector<HTMLButtonElement>('[data-testid="publish"]');
    if (publish === null) {
      throw new Error('测试夹具需要发布按钮');
    }
    let clicked = false;
    publish.addEventListener('click', () => {
      clicked = true;
    });

    const result = await fillXianyuDraft(document, validPayload);

    expect(result.filled).toEqual(
      expect.arrayContaining(['title', 'price', 'description', 'images'])
    );
    expect(document.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(
      '测试发布标题'
    );
    expect(document.querySelector<HTMLInputElement>('input[name="price"]')?.value).toBe('88.5');
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.value).toBe(
      '测试发布描述'
    );
    expect(document.querySelector<HTMLInputElement>('input[name="images"]')?.files).toHaveLength(1);
    expect(clicked).toBe(false);
  });

  it('图片与视频使用不同文件输入框且不触发发布', async () => {
    const document = publishDocument();
    const publish = document.querySelector<HTMLButtonElement>('[data-testid="publish"]');
    if (publish === null) {
      throw new Error('测试夹具需要发布按钮');
    }
    let publishClicked = false;
    publish.addEventListener('click', () => {
      publishClicked = true;
    });
    const videoFile = new File(['video'], 'demo.mp4', { type: 'video/mp4' });

    const result = await fillXianyuDraft(document, validPayload, [videoFile]);

    expect(document.querySelector<HTMLInputElement>('input[name="images"]')?.files).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('input[name="video"]')?.files?.[0]?.name).toBe(
      'demo.mp4'
    );
    expect(result.filled).toContain('video');
    expect(publishClicked).toBe(false);
  });

  it('找不到可靠视频控件时保留文本与图片结果并提示手动上传', async () => {
    const document = publishDocument();
    document.querySelector('input[name="video"]')?.remove();

    const result = await fillXianyuDraft(document, validPayload, [
      new File(['video'], 'demo.mp4', { type: 'video/mp4' })
    ]);

    expect(result.filled).toEqual(
      expect.arrayContaining(['title', 'price', 'description', 'images'])
    );
    expect(result.skipped).toContainEqual({
      field: 'video',
      reason: '未找到可靠的视频上传字段，请在闲鱼页面手动上传视频'
    });
  });

  it('可访问标签能可靠区分没有 name 和 accept 的图片与视频控件', async () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body><label>图片<input type="file" multiple></label><label>视频<input type="file"></label></body></html>',
      'text/html'
    );

    const result = await fillXianyuDraft(document, validPayload, [
      new File(['video'], 'demo.mov', { type: 'video/quicktime' })
    ]);

    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs[0]?.files?.[0]?.name).toBe('image-1.png');
    expect(inputs[1]?.files?.[0]?.name).toBe('demo.mov');
    expect(result.filled).toEqual(expect.arrayContaining(['images', 'video']));
  });

  it('严格校验闲鱼内容脚本返回的成功与失败响应', () => {
    expect(
      parseXianyuFillResult({
        ok: true,
        value: { filled: ['title'], skipped: [], warnings: [] }
      })
    ).toEqual({ ok: true, value: { filled: ['title'], skipped: [], warnings: [] } });
    expect(
      parseXianyuFillResult({
        ok: false,
        error: {
          code: 'XIANYU_FILL_FAILED',
          message: '填写失败',
          recovery: '检查页面',
          draftPreserved: true
        }
      })
    ).toMatchObject({ ok: false, error: { message: '填写失败' } });
    expect(parseXianyuFillResult({ ok: true, value: {} })).toBeNull();
    expect(parseXianyuFillResult({ ok: false, error: '填写失败' })).toBeNull();
  });

  it('文本字段触发 input 和 change 事件', async () => {
    const document = publishDocument();
    const title = document.querySelector<HTMLInputElement>('input[name="title"]');
    if (title === null) {
      throw new Error('测试夹具需要标题输入框');
    }
    const events: string[] = [];
    title.addEventListener('input', () => events.push('input'));
    title.addEventListener('change', () => events.push('change'));

    await fillXianyuDraft(document, { ...validPayload, images: [] });

    expect(events).toEqual(['input', 'change']);
  });

  it('找不到字段时明确返回跳过项', async () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body><main>空页面</main></body></html>',
      'text/html'
    );

    const result = await fillXianyuDraft(document, validPayload);

    expect(result.filled).toEqual([]);
    expect(result.skipped.map((item) => item.field)).toEqual([
      'title',
      'price',
      'description',
      'images'
    ]);
  });
});

describe('downloadImages', () => {
  const draftImage: ProductImage = {
    id: 'draft-image',
    location: {
      kind: 'remote',
      url: 'https://img.example.com/draft-image.png',
      extractedBy: 'open-graph'
    },
    loadStatus: 'loaded'
  };
  const images: ProductImage[] = [
    draftImage,
    {
      id: 'ignored',
      location: {
        kind: 'remote',
        url: 'https://img.example.com/ignored.png',
        extractedBy: 'open-graph'
      },
      loadStatus: 'loaded'
    }
  ];

  it('下载草稿中的全部有效图片并转换为可传输内容', async () => {
    const requested: string[] = [];
    const result = await downloadImages((input) => {
      requested.push(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      );
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '3' }
        })
      );
    }, images);

    expect(requested).toEqual([
      'https://img.example.com/draft-image.png',
      'https://img.example.com/ignored.png'
    ]);
    expect(result.files).toEqual([
      {
        id: 'draft-image',
        name: 'draft-image.png',
        mimeType: 'image/png',
        dataBase64: 'AQID'
      },
      {
        id: 'ignored',
        name: 'ignored.png',
        mimeType: 'image/png',
        dataBase64: 'AQID'
      }
    ]);
    expect(result.failures).toEqual([]);
  });

  it('尚未加载成功的草稿图片不会进入下载队列', async () => {
    const idleImage: ProductImage = {
      ...draftImage,
      id: 'idle',
      loadStatus: 'idle'
    };
    let requested = false;

    const result = await downloadImages(() => {
      requested = true;
      return Promise.resolve(new Response());
    }, [idleImage]);

    expect(requested).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.failures).toEqual([
      expect.objectContaining({ id: 'idle', message: '图片尚未成功加载' })
    ]);
  });

  it.each([
    ['text/html', '图片响应类型不受支持'],
    ['image/svg+xml', '图片响应类型不受支持']
  ])('拒绝不支持的 MIME 类型 %s', async (mimeType, expectedMessage) => {
    const result = await downloadImages(
      () => Promise.resolve(new Response('invalid', { headers: { 'content-type': mimeType } })),
      [draftImage]
    );

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.message).toContain(expectedMessage);
  });

  it('拒绝超过单张上限的图片', async () => {
    const result = await downloadImages(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([1]), {
            headers: { 'content-type': 'image/jpeg', 'content-length': '10485761' }
          })
        ),
      [draftImage]
    );

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.message).toContain('图片超过 10 MB 上限');
  });

  it('图片下载超时后返回失败，不会永久阻塞填表', async () => {
    vi.useFakeTimers();
    try {
      const operation = downloadImages(() => new Promise<Response>(() => undefined), [draftImage]);
      const resultExpectation = expect(operation).resolves.toMatchObject({
        files: [],
        failures: [{ message: '图片下载超时，请稍后重试' }]
      });

      await vi.advanceTimersByTimeAsync(20_000);

      await resultExpectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('图片已返回响应头但正文不结束时仍会超时', async () => {
    vi.useFakeTimers();
    try {
      const response = new Response(new ReadableStream({ start: () => undefined }), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      });
      const operation = downloadImages(() => Promise.resolve(response), [draftImage]);
      const resultExpectation = expect(operation).resolves.toMatchObject({
        files: [],
        failures: [{ message: '图片下载超时，请稍后重试' }]
      });

      await vi.advanceTimersByTimeAsync(20_000);

      await resultExpectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('最多传输共享媒体上限允许的 9 张图片', async () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      ...draftImage,
      id: `image-${String(index + 1)}`,
      location: {
        kind: 'remote' as const,
        url: `https://img.example.com/${String(index + 1)}.png`,
        extractedBy: 'open-graph' as const
      }
    }));
    let requests = 0;

    const result = await downloadImages(() => {
      requests += 1;
      return Promise.resolve(
        new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
      );
    }, images);

    expect(requests).toBe(9);
    expect(result.files).toHaveLength(9);
    expect(result.failures[0]?.message).toContain('最多处理 9 个媒体');
  });

  it('未加载图片仍占用 9 张选择上限，不能用后续图片绕过', async () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      ...draftImage,
      id: `draft-${String(index + 1)}`,
      loadStatus: index === 0 ? ('idle' as const) : ('loaded' as const),
      location: {
        kind: 'remote' as const,
        url: `https://img.example.com/draft-${String(index + 1)}.png`,
        extractedBy: 'open-graph' as const
      }
    }));
    let requests = 0;

    const result = await downloadImages(() => {
      requests += 1;
      return Promise.resolve(
        new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
      );
    }, images);

    expect(requests).toBe(8);
    expect(result.failures.find((failure) => failure.id === 'draft-1')?.message).toBe(
      '图片尚未成功加载'
    );
    expect(result.failures.find((failure) => failure.id === 'draft-10')?.message).toContain(
      '最多处理 9 个媒体'
    );
  });

  it('图片原始数据总量不超过 20 MB', async () => {
    const images = Array.from({ length: 3 }, (_, index) => ({
      ...draftImage,
      id: `large-${String(index + 1)}`,
      location: {
        kind: 'remote' as const,
        url: `https://img.example.com/large-${String(index + 1)}.png`,
        extractedBy: 'open-graph' as const
      }
    }));

    const result = await downloadImages(
      () =>
        Promise.resolve(
          new Response(new Uint8Array(8 * 1024 * 1024), {
            headers: { 'content-type': 'image/png' }
          })
        ),
      images
    );

    expect(result.files).toHaveLength(2);
    expect(result.failures[0]?.message).toContain('图片总量超过 20 MB 上限');
  });
});

describe('prepareImages', () => {
  it('从本地媒体仓储读取草稿图片', async () => {
    const fetchMock: ImageFetchLike = () => Promise.reject(new Error('本地图片不应触发网络请求'));
    const mediaStoreMock: Pick<MediaStore, 'get'> = {
      get: () =>
        Promise.resolve({
          assetId: 'asset-1',
          kind: 'image' as const,
          fileName: 'local.png',
          mimeType: 'image/png',
          byteLength: 3,
          createdAt: '2026-08-31T13:00:00.000Z',
          blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        })
    };

    const result = await prepareImages(fetchMock, mediaStoreMock, [
      {
        id: 'local-1',
        location: {
          kind: 'local',
          assetId: 'asset-1',
          fileName: 'local.png',
          mimeType: 'image/png',
          byteLength: 3
        },
        loadStatus: 'loaded'
      }
    ]);

    expect(result.files).toEqual([
      expect.objectContaining({ id: 'local-1', name: 'local.png', mimeType: 'image/png' })
    ]);
  });

  it('本地资源缺失时安全跳过且不阻止其余图片', async () => {
    const result = await prepareImages(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([4, 5]), {
            headers: { 'content-type': 'image/jpeg', 'content-length': '2' }
          })
        ),
      { get: () => Promise.resolve(null) },
      [
        {
          id: 'missing',
          location: {
            kind: 'local',
            assetId: 'missing-asset',
            fileName: 'missing.png',
            mimeType: 'image/png',
            byteLength: 3
          },
          loadStatus: 'loaded'
        },
        {
          id: 'remote',
          location: {
            kind: 'remote',
            url: 'https://img.example.com/remote.jpg',
            extractedBy: 'semantic-dom'
          },
          loadStatus: 'loaded'
        }
      ]
    );

    expect(result.files.map((file) => file.id)).toEqual(['remote']);
    expect(result.failures).toContainEqual({ id: 'missing', message: '本地图片不存在或已被删除' });
  });

  it.each([
    ['image/svg+xml', 3, '图片类型不受支持'],
    ['image/png', 10 * 1024 * 1024 + 1, '图片超过 10 MB 上限']
  ])('本地图片统一执行 MIME 与单图大小限制：%s', async (mimeType, byteLength, message) => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: mimeType });
    Object.defineProperty(blob, 'size', { value: byteLength });
    const result = await prepareImages(
      () => Promise.reject(new Error('不应下载本地图片')),
      {
        get: () =>
          Promise.resolve({
            assetId: 'asset-1',
            kind: 'image',
            fileName: 'local.png',
            mimeType,
            byteLength,
            createdAt: '2026-08-31T13:00:00.000Z',
            blob
          })
      },
      [
        {
          id: 'local',
          location: {
            kind: 'local',
            assetId: 'asset-1',
            fileName: 'local.png',
            mimeType: 'image/png',
            byteLength: 3
          },
          loadStatus: 'loaded'
        }
      ]
    );

    expect(result.files).toEqual([]);
    expect(result.failures[0]?.message).toContain(message);
  });
});
