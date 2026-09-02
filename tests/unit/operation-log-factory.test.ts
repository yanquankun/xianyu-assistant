import { describe, expect, it } from 'vitest';

import {
  createAiPolishFailureLogEntry,
  createAiPolishSuccessLogEntry,
  createFailureLogEntry,
  createSuccessLogEntry
} from '../../src/background/operation-log-factory';
import type { ProductDraft } from '../../src/domain/product';
import type { AiSettings } from '../../src/domain/settings';
import type { MediaStore } from '../../src/storage/media-store';
import { formatImageDownloadFailureWarning, prepareImages } from '../../src/xianyu/fill';

const settings: AiSettings = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'settings-secret',
  model: 'gpt-test',
  temperature: 0.3,
  systemInstruction: 'do not copy this instruction'
};

const draft: ProductDraft = {
  id: 'draft-1',
  platform: 'jd',
  canonicalUrl: 'https://item.jd.com/1.html',
  source: {
    title: '来源标题',
    description: '来源描述',
    price: 99,
    currency: 'CNY'
  },
  title: '输入标题',
  description: '输入描述',
  price: 88,
  originalPrice: 99,
  currency: 'CNY',
  images: [
    {
      id: 'image-1',
      location: {
        kind: 'local',
        assetId: 'asset-secret',
        fileName: 'local-image.png',
        mimeType: 'image/png',
        byteLength: 100
      },
      loadStatus: 'loaded'
    }
  ],
  videos: [
    {
      id: 'video-1',
      assetId: 'video-asset-secret',
      fileName: 'local-video.mp4',
      mimeType: 'video/mp4',
      byteLength: 100
    }
  ],
  warnings: ['请核对规格'],
  confidence: 'high',
  shippingMethod: '包邮',
  supportsPickup: false,
  categoryNote: '分类备注',
  updatedAt: '2026-08-31T14:00:00.000Z'
};

describe('operation log factory', () => {
  it('AI 润色日志保留原标题和生成后的描述，但不记录密钥', () => {
    const entry = createAiPolishSuccessLogEntry(
      draft,
      { description: '润色后的商品描述', factWarnings: ['请核对数字'] },
      'polish-log',
      '2026-09-02T10:00:00.000Z'
    );

    expect(entry).toMatchObject({
      stage: 'ai',
      outcome: 'success',
      displayTitle: '输入标题',
      operationLabel: 'AI 润色',
      details: {
        draft: { title: '输入标题', description: '润色后的商品描述' },
        warnings: ['请核对数字'],
        result: 'AI 商品描述已生成'
      }
    });
    expect(JSON.stringify(entry)).not.toMatch(/settings-secret|asset-secret|video-asset-secret/u);
  });

  it('AI 润色失败日志脱敏接口错误并保留原草稿快照', () => {
    const entry = createAiPolishFailureLogEntry(
      draft,
      'Authorization: Bearer error-secret',
      'AI_NETWORK_ERROR',
      'polish-failure-log',
      '2026-09-02T10:01:00.000Z'
    );

    expect(entry).toMatchObject({
      stage: 'ai',
      outcome: 'failure',
      displayTitle: '输入标题',
      operationLabel: 'AI 润色',
      details: { draft: { description: '输入描述' }, error: 'Authorization: [已脱敏]' }
    });
    expect(JSON.stringify(entry)).not.toContain('error-secret');
  });

  it('解析成功日志只保留字段完成度和规范 URL', () => {
    const sourceTitle = '不得写入日志的来源标题';
    const sourceDescription = '不得写入日志的来源描述';
    const entry = createSuccessLogEntry(
      {
        type: 'PARSE_PRODUCT',
        operationId: 'parse-1',
        submittedUrl: 'https://3.cn/short?jkl=@code@',
        url: 'https://3.cn/short?jkl=@code@',
        hintedTitle: '分享标题'
      },
      {
        platform: 'jd',
        submittedUrl: 'https://3.cn/short?jkl=@code@',
        canonicalUrl: 'https://item.jd.com/product/1.html',
        title: sourceTitle,
        description: sourceDescription,
        price: 88,
        originalPrice: 99,
        currency: 'CNY',
        images: [
          {
            id: 'source-image',
            location: {
              kind: 'remote',
              url: 'https://img.example.com/source.jpg',
              extractedBy: 'platform-gallery'
            },
            loadStatus: 'idle'
          }
        ],
        warnings: ['当前售价为到手价，请发布前核对适用条件'],
        confidence: 'high'
      },
      'parse-log',
      '2026-08-31T14:00:00.000Z'
    );

    expect(entry).not.toHaveProperty('displayTitle');
    expect(entry.details).not.toHaveProperty('draft');
    expect(entry.details?.source).toEqual({
      platform: 'jd',
      canonicalUrl: 'https://item.jd.com/product/1.html',
      imageUrls: ['https://img.example.com/source.jpg'],
      fields: {
        title: true,
        description: true,
        price: true,
        originalPrice: true,
        imageCount: 1
      }
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toMatch(
      /分享标题|不得写入日志的来源标题|不得写入日志的来源描述|@code@/u
    );
  });

  it('AI 成功记录使用生成标题并保存不可变表单快照', () => {
    const inputDraft: ProductDraft = {
      ...draft,
      source: { ...draft.source },
      images: [...draft.images],
      videos: draft.videos.map((video) => ({ ...video }))
    };
    const entry = createSuccessLogEntry(
      { type: 'EXPAND_DRAFT', settings, draft: inputDraft },
      {
        title: '当时生成的标题',
        description: '当时生成的描述',
        warnings: ['请核对规格'],
        factWarnings: []
      },
      'log-1',
      '2026-08-31T14:00:00.000Z'
    );

    expect(entry).toMatchObject({
      displayTitle: '当时生成的标题',
      operationLabel: 'AI 扩写',
      details: {
        draft: {
          sourceUrl: 'https://item.jd.com/1.html',
          canonicalUrl: 'https://item.jd.com/1.html',
          title: '当时生成的标题',
          description: '当时生成的描述',
          price: 88,
          originalPrice: 99,
          shippingMethod: '包邮',
          supportsPickup: false,
          categoryNote: '分类备注',
          selectedImageCount: 1,
          videoName: 'local-video.mp4'
        },
        warnings: ['请核对规格']
      }
    });
    expect(JSON.stringify(entry)).not.toMatch(/settings-secret|asset-secret|video-asset-secret/u);

    inputDraft.title = '之后编辑的标题';
    expect(entry.details?.draft?.title).toBe('当时生成的标题');
  });

  it('失败记录允许输入草稿标题但绝不复制设置', () => {
    const entry = createFailureLogEntry(
      { type: 'EXPAND_DRAFT', settings, draft },
      'Authorization: Bearer error-secret',
      'AI_NETWORK_ERROR',
      'log-2',
      '2026-08-31T14:01:00.000Z'
    );

    expect(entry.displayTitle).toBe('输入标题');
    expect(entry.operationLabel).toBe('AI 扩写');
    expect(entry.details?.error).toBe('Authorization: [已脱敏]');
    expect(JSON.stringify(entry)).not.toMatch(/settings-secret|error-secret|do not copy/u);
  });

  it('本地图片失败结果进入成功日志后不包含真实 assetId', async () => {
    const assetId = '8f14e45f-ea47-4b3f-a30b-9f12e7d6c421';
    const localImage = {
      id: `local-${assetId}`,
      location: {
        kind: 'local' as const,
        assetId,
        fileName: 'receipt.png',
        mimeType: 'image/png' as const,
        byteLength: 3
      },
      loadStatus: 'loaded' as const
    };
    const mediaStore: Pick<MediaStore, 'get'> = { get: () => Promise.resolve(null) };
    const imageResult = await prepareImages(
      () => Promise.reject(new Error('本地图片不应请求网络')),
      mediaStore,
      [localImage]
    );
    const entry = createSuccessLogEntry(
      { type: 'FILL_XIANYU_DRAFT', draft: { ...draft, images: [localImage] } },
      {
        filled: ['title', 'price', 'description'],
        skipped: [{ field: 'images', reason: '本地图片不存在或已被删除' }],
        warnings: imageResult.failures.map(formatImageDownloadFailureWarning)
      },
      'fill-log',
      '2026-08-31T14:02:00.000Z'
    );

    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(assetId);
    expect(serialized).not.toContain(`local-${assetId}`);
    expect(entry.details?.warnings).toContain('图片 1：本地图片不存在或已被删除');
  });

  it('填表日志使用中文字段名并保留邮费与自提快照', () => {
    const entry = createSuccessLogEntry(
      {
        type: 'FILL_XIANYU_DRAFT',
        draft: {
          ...draft,
          shippingMethod: '一口价',
          shippingFee: 12,
          supportsPickup: true
        }
      },
      {
        filled: [
          'title',
          'price',
          'originalPrice',
          'description',
          'shippingMethod',
          'shippingFee',
          'supportsPickup',
          'images'
        ],
        skipped: [],
        warnings: []
      },
      'fill-delivery-log',
      '2026-09-02T10:00:00.000Z'
    );

    expect(entry.details?.draft).toMatchObject({
      shippingMethod: '一口价',
      shippingFee: 12,
      supportsPickup: true
    });
    expect(entry.details?.result).toBe(
      '已填入：标题、售价、原价、描述、发货方式、邮费金额、支持自提、商品图片'
    );
  });
});
