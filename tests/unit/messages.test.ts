import { describe, expect, it } from 'vitest';

import {
  parseParsedProduct,
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
