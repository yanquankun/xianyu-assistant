import { describe, expect, it } from 'vitest';

import { REQUIRED_PERMISSIONS } from '../../wxt.config';

import {
  ensureProductDestination,
  getProductPermissionOrigins,
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
    ['https://detail.tmall.com/item.htm?id=1', 'tmall'],
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

describe('getProductPermissionOrigins', () => {
  it('京东短链只请求短链和京东固定域名族', () => {
    expect(getProductPermissionOrigins(new URL('https://3.cn/31-f4Z6b?jkl=@code@'))).toEqual([
      'https://3.cn/*',
      'https://*.jd.com/*'
    ]);
  });

  it('淘宝短链只请求短链和淘宝天猫固定域名族', () => {
    expect(getProductPermissionOrigins(new URL('https://e.tb.cn/h.test?tk=abc'))).toEqual([
      'https://e.tb.cn/*',
      'https://*.taobao.com/*',
      'https://*.tmall.com/*'
    ]);
  });

  it.each([
    ['https://item.jd.com/100.html', ['https://item.jd.com/*']],
    ['https://item.taobao.com/item.htm?id=1', ['https://item.taobao.com/*']],
    ['https://detail.tmall.com/item.htm?id=1', ['https://detail.tmall.com/*']],
    ['https://shop.example.com/item/1', ['https://shop.example.com/*']]
  ] as const)('正式页面 %s 继续只请求精确来源', (input, expected) => {
    expect(getProductPermissionOrigins(new URL(input))).toEqual(expected);
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

  it('短链只能落入对应平台正式域名族', () => {
    expect(() =>
      ensureProductDestination(
        normalizeHttpUrl('https://3.cn/31-f4Z6b'),
        'https://item.jd.com/100.html'
      )
    ).not.toThrow();
    expect(() =>
      ensureProductDestination(
        normalizeHttpUrl('https://e.tb.cn/h.test'),
        'https://detail.tmall.com/item.htm?id=1'
      )
    ).not.toThrow();
    expect(() =>
      ensureProductDestination(
        normalizeHttpUrl('https://e.tb.cn/h.test'),
        'https://item.taobao.com/item.htm?id=1'
      )
    ).not.toThrow();
    expect(() =>
      ensureProductDestination(
        normalizeHttpUrl('https://3.cn/31-f4Z6b'),
        'https://item.taobao.com/item.htm?id=1'
      )
    ).toThrow('商品页跳转到了不受支持的站点');
  });

  it.each([
    'https://passport.jd.com/login',
    'https://item.jd.com/verify/captcha',
    'https://item.jd.com/risk/index.html',
    'https://item.jd.com/error/404.html'
  ])('拒绝登录、验证、验证码、风险或错误路由：%s', (destination) => {
    expect(() =>
      ensureProductDestination(normalizeHttpUrl('https://3.cn/31-f4Z6b'), destination)
    ).toThrow();
  });
});

describe('REQUIRED_PERMISSIONS', () => {
  it('使用扩展持久化需要的最小权限', () => {
    expect(REQUIRED_PERMISSIONS).toContain('unlimitedStorage');
    expect(REQUIRED_PERMISSIONS).not.toEqual(
      expect.arrayContaining(['cookies', 'debugger', 'history'])
    );
  });
});
