import { describe, expect, it } from 'vitest';

import {
  classifyProductHost,
  parseProductIdentity,
  sameProductIdentity,
  sanitizeProductLogUrl
} from '../../src/domain/product-url';

describe('product URL identity', () => {
  it.each([
    [
      'https://item.taobao.com/item.htm?id=123&utm_source=share',
      'taobao',
      '123',
      'https://item.taobao.com/item.htm?id=123'
    ],
    [
      'https://detail.tmall.com/item.htm?id=456&skuId=789&spm=a1',
      'tmall',
      '456',
      'https://detail.tmall.com/item.htm?id=456&skuId=789'
    ],
    [
      'https://item.jd.com/101.html?utm_source=ios',
      'jd',
      '101',
      'https://item.jd.com/101.html'
    ],
    [
      'https://item.m.jd.com/product/202.html?jkl=@code@',
      'jd',
      '202',
      'https://item.m.jd.com/product/202.html'
    ]
  ] as const)(
    '提取 %s 的平台、商品主标识和规范链接',
    (input, platform, productId, canonicalUrl) => {
      expect(parseProductIdentity(input)).toMatchObject({ platform, productId, canonicalUrl });
    }
  );

  it('识别短链所属域名族，但不把短链误判为商品身份', () => {
    expect(classifyProductHost('e.tb.cn')).toEqual({
      platformHint: 'taobao',
      domainFamily: 'taobao-family',
      isShortLink: true
    });
    expect(classifyProductHost('3.cn')).toEqual({
      platformHint: 'jd',
      domainFamily: 'jd-family',
      isShortLink: true
    });
    expect(parseProductIdentity('https://e.tb.cn/h.test?tk=abc')).toBeNull();
    expect(parseProductIdentity('https://3.cn/short?jkl=@code@')).toBeNull();
  });

  it('按平台、商品主标识和双方均存在的 SKU 判断同一商品', () => {
    const base = parseProductIdentity('https://detail.tmall.com/item.htm?id=1');
    const sku2 = parseProductIdentity('https://detail.tmall.com/item.htm?id=1&skuId=2');
    const sku3 = parseProductIdentity('https://detail.tmall.com/item.htm?id=1&sku_id=3');
    const taobao = parseProductIdentity('https://item.taobao.com/item.htm?id=1');

    expect(base).not.toBeNull();
    expect(sku2).not.toBeNull();
    expect(sku3).not.toBeNull();
    expect(taobao).not.toBeNull();
    if (base === null || sku2 === null || sku3 === null || taobao === null) {
      throw new Error('测试需要有效的商品身份');
    }

    expect(sameProductIdentity(base, sku2)).toBe(true);
    expect(sameProductIdentity(sku2, sku3)).toBe(false);
    expect(sameProductIdentity(base, taobao)).toBe(false);
  });

  it('拒绝非商品路由、非数字标识和非 HTTP(S) 地址', () => {
    expect(parseProductIdentity('https://detail.tmall.com/not-item?id=1')).toBeNull();
    expect(parseProductIdentity('https://item.taobao.com/item.htm?id=abc')).toBeNull();
    expect(parseProductIdentity('https://item.jd.com/not-a-number.html')).toBeNull();
    expect(parseProductIdentity('file:///tmp/item.jd.com/1.html')).toBeNull();
  });

  it('日志 URL 删除凭据、分享参数、追踪参数和片段', () => {
    expect(sanitizeProductLogUrl('https://user:pass@3.cn/short?jkl=@code@#share')).toBe(
      'https://3.cn/short'
    );
    expect(
      sanitizeProductLogUrl(
        'https://detail.tmall.com/item.htm?id=1&skuId=2&spm=a1&utm_source=share#detail'
      )
    ).toBe('https://detail.tmall.com/item.htm?id=1&skuId=2');
    expect(
      sanitizeProductLogUrl(
        'https://shop.example.com/item?page=2&token=secret&utm_source=share#detail'
      )
    ).toBe('https://shop.example.com/item?page=2');
  });
});
