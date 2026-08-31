import { describe, expect, it } from 'vitest';

import {
  isProductDraft,
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
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '',
  updatedAt: '2026-08-31T12:00:00.000Z'
};

describe('parseRuntimeMessage', () => {
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
    { type: 'PARSE_PRODUCT', operationId: '', url: 'https://item.jd.com/1.html' },
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
});

describe('parseStoredProductDraft', () => {
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

    expect(result).toEqual({
      migrated: true,
      draft: expect.objectContaining({
        images: [
          expect.objectContaining({
            id: 'legacy-image',
            location: {
              kind: 'remote',
              url: 'https://img.example.com/a.jpg',
              extractedBy: 'dom'
            }
          })
        ]
      })
    });
  });

  it('拒绝同时缺少远程地址和本地资源标识的图片', () => {
    expect(
      isProductDraft({
        ...draft,
        images: [
          { id: 'bad', location: { kind: 'local' }, selected: true, loadStatus: 'loaded' }
        ]
      })
    ).toBe(false);
  });

  it.each(['blob:temporary-image', 'data:image/png;base64,aGVsbG8=', 'javascript:alert(1)', '/image.jpg'])(
    '迁移时移除非 HTTP(S) 旧版图片：%s',
    (url) => {
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
    }
  );

  it.each(['blob:temporary-image', 'data:image/png;base64,aGVsbG8=', 'javascript:alert(1)', '/image.jpg'])(
    '运行时消息拒绝非 HTTP(S) 远程图片：%s',
    (url) => {
      expect(
        parseRuntimeMessage({
          type: 'FILL_XIANYU_DRAFT',
          draft: {
            ...draft,
            images: [
              {
                id: 'remote-image',
                location: { kind: 'remote', url, extractedBy: 'dom' },
                selected: true,
                loadStatus: 'loaded'
              }
            ]
          }
        })
      ).toBeNull();
    }
  );

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
                extractedBy: 'dom'
              },
              selected: true,
              loadStatus: 'loaded'
            }
          ]
        }
      })
    ).not.toBeNull();
  });
});
