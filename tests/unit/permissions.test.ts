import { describe, expect, it } from 'vitest';

import {
  ensureProductDestination,
  getRequestedOrigin,
  normalizeHttpUrl
} from '../../src/background/permissions';

describe('normalizeHttpUrl', () => {
  it.each(['javascript:alert(1)', 'file:///tmp/a', 'chrome://settings', 'data:text/plain,a'])(
    '拒绝非 HTTP URL：%s',
    (value) => {
      expect(() => normalizeHttpUrl(value)).toThrow('仅支持 HTTP 或 HTTPS 商品链接');
    }
  );

  it('拒绝空白和无法解析的 URL', () => {
    expect(() => normalizeHttpUrl('   ')).toThrow('请输入完整商品链接');
    expect(() => normalizeHttpUrl('item.jd.com/1.html')).toThrow('请输入有效的完整商品链接');
  });

  it('移除 URL 用户信息和片段', () => {
    const result = normalizeHttpUrl('https://user:pass@item.jd.com/1.html?sku=2#detail');

    expect(result.href).toBe('https://item.jd.com/1.html?sku=2');
    expect(result.platform).toBe('jd');
  });

  it.each([
    ['https://item.taobao.com/item.htm?id=1', 'taobao'],
    ['https://detail.tmall.com/item.htm?id=1', 'taobao'],
    ['https://item.jd.com/1.html', 'jd'],
    ['https://shop.example.com/item/1', 'generic']
  ] as const)('识别 %s 的平台为 %s', (value, platform) => {
    expect(normalizeHttpUrl(value).platform).toBe(platform);
  });
});

describe('getRequestedOrigin', () => {
  it('运行时只请求精确来源', () => {
    expect(getRequestedOrigin(new URL('https://item.jd.com/100.html?x=1'))).toBe(
      'https://item.jd.com/*'
    );
  });

  it('保留非默认端口', () => {
    expect(getRequestedOrigin(new URL('http://localhost:4173/item'))).toBe(
      'http://localhost:4173/*'
    );
  });
});

describe('ensureProductDestination', () => {
  it('允许同平台商品页，并拒绝登录或跨站重定向', () => {
    const source = normalizeHttpUrl('https://item.taobao.com/item.htm?id=1');

    expect(() =>
      ensureProductDestination(source, 'https://detail.tmall.com/item.htm?id=1')
    ).not.toThrow();
    expect(() =>
      ensureProductDestination(source, 'https://login.taobao.com/havanaone/login.htm')
    ).toThrow('商品页跳转到了登录或验证页面');
    expect(() => ensureProductDestination(source, 'https://example.com/login')).toThrow(
      '商品页跳转到了不受支持的站点'
    );
  });
});
