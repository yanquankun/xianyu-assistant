import { describe, expect, it } from 'vitest';

import {
  isProductDraft,
  parseProductExtractionResponse,
  parseParsedProduct,
  parseStoredProductDraft,
  parseRuntimeMessage,
  runtimeMessageTypes
} from '../../src/domain/messages';

const draft = {
  id: 'draft-1',
  platform: 'taobao',
  canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
  source: {
    title: '来源标题',
    description: '来源描述',
    price: 99,
    currency: 'CNY'
  },
  title: '编辑标题',
  description: '编辑描述',
  price: 88,
  currency: 'CNY',
  images: [],
  videos: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '',
  updatedAt: '2026-08-31T12:00:00.000Z'
};

describe('parseRuntimeMessage', () => {
  it('商品解析消息只接受提取后的双 URL 和可选标题提示', () => {
    expect(
      parseRuntimeMessage({
        type: 'PARSE_PRODUCT',
        operationId: 'operation-1',
        submittedUrl: 'https://3.cn/31-f4Z6b?jkl=@code@',
        url: 'https://3.cn/31-f4Z6b?jkl=@code@',
        hintedTitle: '书名号标题'
      })
    ).toEqual({
      type: 'PARSE_PRODUCT',
      operationId: 'operation-1',
      submittedUrl: 'https://3.cn/31-f4Z6b?jkl=@code@',
      url: 'https://3.cn/31-f4Z6b?jkl=@code@',
      hintedTitle: '书名号标题'
    });
  });

  it('接受结构完整的消息', () => {
    expect(
      parseRuntimeMessage({
        type: 'EXPAND_DRAFT',
        settings: {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'test-key',
          model: 'gpt-test',
          temperature: 0.3,
          systemInstruction: ''
        },
        draft
      })
    ).not.toBeNull();
  });

  it.each([
    {
      type: 'PARSE_PRODUCT',
      operationId: '',
      submittedUrl: 'https://item.jd.com/1.html',
      url: 'https://item.jd.com/1.html'
    },
    {
      type: 'PARSE_PRODUCT',
      operationId: 'operation-1',
      submittedUrl: 'https://item.jd.com/1.html',
      url: 'javascript:alert(1)'
    },
    {
      type: 'PARSE_PRODUCT',
      operationId: 'operation-1',
      submittedUrl: 'https://item.jd.com/1.html',
      url: 'https://item.jd.com/1.html',
      shareText: '整段分享文案不得进入后台消息'
    },
    { type: 'TEST_AI_CONNECTION', settings: { apiKey: 'missing-fields' } },
    { type: 'EXPAND_DRAFT', settings: null, draft },
    { type: 'FILL_XIANYU_DRAFT', draft: { ...draft, price: Number.NaN } },
    { type: 'FILL_XIANYU_DRAFT', draft: { ...draft, originalPrice: null } },
    { type: 'FILL_XIANYU_DRAFT', draft: { ...draft, originalPrice: 0 } },
    { type: 'FILL_XIANYU_DRAFT', draft: { ...draft, originalPrice: -1 } },
    { type: 'FILL_XIANYU_DRAFT', draft: { ...draft, originalPrice: Number.POSITIVE_INFINITY } },
    {
      type: 'FILL_XIANYU_DRAFT',
      draft: { ...draft, source: { ...draft.source, originalPrice: null } }
    },
    { type: 'FILL_XIANYU_DRAFT', draft: { ...draft, images: new Array(21).fill({}) } }
  ])('拒绝无效或超出边界的消息：%j', (message) => {
    expect(parseRuntimeMessage(message)).toBeNull();
  });

  it('草稿和解析结果兼容可选提交 URL，并拒绝非 HTTP(S) 值', () => {
    expect(isProductDraft({ ...draft, submittedUrl: 'https://e.tb.cn/h.test?tk=@code@' })).toBe(
      true
    );
    expect(isProductDraft({ ...draft, submittedUrl: '分享文案原文' })).toBe(false);
    expect(
      isProductDraft({
        ...draft,
        platform: 'tmall',
        canonicalUrl: 'https://detail.tmall.com/item.htm?id=1'
      })
    ).toBe(true);
    expect(
      parseParsedProduct({
        platform: 'taobao',
        submittedUrl: 'https://e.tb.cn/h.test',
        canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
        title: '商品',
        description: '',
        price: null,
        currency: 'CNY',
        images: [],
        warnings: [],
        confidence: 'low'
      })
    ).toMatchObject({ submittedUrl: 'https://e.tb.cn/h.test' });
  });

  it('消息白名单中不存在最终发布动作', () => {
    expect(runtimeMessageTypes.join(' ')).not.toMatch(/publish|submit|发布/iu);
  });

  it('拒绝超出边界的商品解析响应', () => {
    expect(
      parseParsedProduct({
        platform: 'taobao',
        canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
        title: '商品',
        description: '描述',
        price: 1,
        currency: 'CNY',
        images: new Array(21).fill({}),
        warnings: [],
        confidence: 'high'
      })
    ).toBeNull();
  });

  it('拒绝与类型定义不一致的空原价', () => {
    expect(
      parseParsedProduct({
        platform: 'taobao',
        canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
        title: '商品',
        description: '描述',
        price: 1,
        originalPrice: null,
        currency: 'CNY',
        images: [],
        warnings: [],
        confidence: 'high'
      })
    ).toBeNull();
  });

  it('严格解析可判别的商品提取成功和失败响应', () => {
    const product = {
      platform: 'jd',
      canonicalUrl: 'https://item.jd.com/product/1.html',
      title: '商品',
      description: '',
      price: null,
      currency: 'CNY',
      images: [],
      warnings: [],
      confidence: 'low'
    };

    expect(parseProductExtractionResponse({ ok: true, product })).toEqual({ ok: true, product });
    expect(
      parseProductExtractionResponse({
        ok: false,
        error: { message: '页面不存在', code: 'PAGE_ERROR' }
      })
    ).toEqual({ ok: false, error: { message: '页面不存在', code: 'PAGE_ERROR' } });
    expect(
      parseProductExtractionResponse({ ok: true, product: { title: '字段不完整' } })
    ).toBeNull();
    expect(parseProductExtractionResponse({ ok: false, error: { message: 400 } })).toBeNull();
    expect(
      parseProductExtractionResponse({ ok: false, error: { message: '错误', extra: {} } })
    ).toBeNull();
  });
});

describe('parseStoredProductDraft', () => {
  it('把规范链接明确指向天猫的旧淘宝草稿迁移为天猫', () => {
    expect(
      parseStoredProductDraft({
        ...draft,
        platform: 'taobao',
        canonicalUrl: 'https://detail.tmall.com/item.htm?id=1'
      })
    ).toMatchObject({
      migrated: true,
      draft: { platform: 'tmall' }
    });
  });

  it.each(['', 'not-a-url', 'https://item.taobao.com/item.htm?id=1'])(
    '旧淘宝草稿的规范链接为 %s 时保持原平台',
    (canonicalUrl) => {
      expect(
        parseStoredProductDraft({ ...draft, platform: 'taobao', canonicalUrl })
      ).toMatchObject({
        migrated: false,
        draft: { platform: 'taobao' }
      });
    }
  );

  it('迁移旧选中态和单视频时只保留会提交的媒体并遵守九个上限', () => {
    const result = parseStoredProductDraft({
      ...draft,
      videos: undefined,
      images: Array.from({ length: 10 }, (_, index) => ({
        id: `legacy-${String(index + 1)}`,
        location: {
          kind: 'remote',
          url: `https://img.example.com/${String(index + 1)}.jpg`,
          extractedBy: 'dom'
        },
        selected: index !== 1,
        loadStatus: 'loaded'
      })),
      video: {
        id: 'legacy-video',
        assetId: 'asset-video',
        fileName: 'demo.mp4',
        mimeType: 'video/mp4',
        byteLength: 5
      }
    });

    expect(result?.migrated).toBe(true);
    expect(result?.draft.images).toHaveLength(8);
    expect(result?.draft.images[0]).not.toHaveProperty('selected');
    expect(result?.draft.videos).toEqual([
      {
        id: 'legacy-video',
        assetId: 'asset-video',
        fileName: 'demo.mp4',
        mimeType: 'video/mp4',
        byteLength: 5
      }
    ]);
    expect(result?.draft).not.toHaveProperty('video');
  });

  it('运行时草稿按图片和视频合计九个媒体校验', () => {
    const image = {
      id: 'remote-image',
      location: {
        kind: 'remote',
        url: 'https://img.example.com/remote.jpg',
        extractedBy: 'semantic-dom'
      },
      loadStatus: 'loaded'
    };
    const video = {
      id: 'local-video',
      assetId: 'asset-video',
      fileName: 'demo.mp4',
      mimeType: 'video/mp4',
      byteLength: 5
    };

    expect(isProductDraft({ ...draft, images: new Array(8).fill(image), videos: [video] })).toBe(
      true
    );
    expect(isProductDraft({ ...draft, images: new Array(9).fill(image), videos: [video] })).toBe(
      false
    );
  });

  it('把旧版远程图片迁移为可判别位置结构', () => {
    const result = parseStoredProductDraft({
      ...draft,
      images: [
        {
          id: 'legacy-image',
          url: 'https://img.example.com/a.jpg',
          source: 'dom',
          selected: true,
          loadStatus: 'loaded'
        }
      ]
    });

    expect(result?.migrated).toBe(true);
    expect(result?.draft.images).toEqual([
      {
        id: 'legacy-image',
        location: {
          kind: 'remote',
          url: 'https://img.example.com/a.jpg',
          extractedBy: 'semantic-dom'
        },
        loadStatus: 'loaded'
      }
    ]);
  });

  it('拒绝同时缺少远程地址和本地资源标识的图片', () => {
    expect(
      isProductDraft({
        ...draft,
        images: [{ id: 'bad', location: { kind: 'local' }, selected: true, loadStatus: 'loaded' }]
      })
    ).toBe(false);
  });

  it.each([
    'blob:temporary-image',
    'data:image/png;base64,aGVsbG8=',
    'javascript:alert(1)',
    '/image.jpg'
  ])('迁移时移除非 HTTP(S) 旧版图片：%s', (url) => {
    const result = parseStoredProductDraft({
      ...draft,
      images: [
        {
          id: 'legacy-image',
          url,
          source: 'dom',
          selected: true,
          loadStatus: 'loaded'
        }
      ]
    });

    expect(result).toMatchObject({
      migrated: true,
      draft: {
        images: [],
        warnings: ['已移除无法恢复的旧版图片']
      }
    });
  });

  it.each([
    'blob:temporary-image',
    'data:image/png;base64,aGVsbG8=',
    'javascript:alert(1)',
    '/image.jpg'
  ])('运行时消息拒绝非 HTTP(S) 远程图片：%s', (url) => {
    expect(
      parseRuntimeMessage({
        type: 'FILL_XIANYU_DRAFT',
        draft: {
          ...draft,
          images: [
            {
              id: 'remote-image',
              location: { kind: 'remote', url, extractedBy: 'semantic-dom' },
              selected: true,
              loadStatus: 'loaded'
            }
          ]
        }
      })
    ).toBeNull();
  });

  it('运行时消息接受完整 HTTPS 远程图片', () => {
    expect(
      parseRuntimeMessage({
        type: 'FILL_XIANYU_DRAFT',
        draft: {
          ...draft,
          images: [
            {
              id: 'remote-image',
              location: {
                kind: 'remote',
                url: 'https://img.example.com/remote.jpg',
                extractedBy: 'semantic-dom'
              },
              loadStatus: 'loaded'
            }
          ]
        }
      })
    ).not.toBeNull();
  });
});
