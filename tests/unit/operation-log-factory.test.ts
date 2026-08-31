import { describe, expect, it } from 'vitest';

import { createFailureLogEntry, createSuccessLogEntry } from '../../src/background/operation-log-factory';
import type { ProductDraft } from '../../src/domain/product';
import type { AiSettings } from '../../src/domain/settings';

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
      selected: true,
      loadStatus: 'loaded'
    }
  ],
  video: {
    id: 'video-1',
    assetId: 'video-asset-secret',
    fileName: 'local-video.mp4',
    mimeType: 'video/mp4',
    byteLength: 100
  },
  warnings: ['请核对规格'],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '分类备注',
  updatedAt: '2026-08-31T14:00:00.000Z'
};

describe('operation log factory', () => {
  it('解析成功快照同时保留提交短链和最终规范 URL', () => {
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
        title: '真实标题',
        description: '',
        price: null,
        currency: 'CNY',
        images: [],
        warnings: [],
        confidence: 'low'
      },
      'parse-log',
      '2026-08-31T14:00:00.000Z'
    );

    expect(entry.details?.draft).toMatchObject({
      sourceUrl: 'https://3.cn/short?jkl=@code@',
      canonicalUrl: 'https://item.jd.com/product/1.html'
    });
    expect(JSON.stringify(entry)).not.toContain('分享标题');
  });

  it('AI 成功记录使用生成标题并保存不可变表单快照', () => {
    const inputDraft: ProductDraft = {
      ...draft,
      source: { ...draft.source },
      images: [...draft.images],
      ...(draft.video === undefined ? {} : { video: { ...draft.video } })
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
});
