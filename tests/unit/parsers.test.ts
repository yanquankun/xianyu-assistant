import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getRemoteImageUrl } from '../../src/domain/product';
import {
  detectProductPageError,
  extractProductDocument,
  parseProductDocument
} from '../../src/parsers/common';

function parseFixture(name: string, pageUrl: string) {
  const html = readFileSync(resolve(process.cwd(), 'tests', 'fixtures', name), 'utf8');
  const document = new DOMParser().parseFromString(html, 'text/html');
  return parseProductDocument(document, pageUrl);
}

describe('parseProductDocument', () => {
  it('从淘宝夹具合并结构化标题、价格和去重图片', () => {
    const result = parseFixture(
      'taobao-product.html',
      'https://item.taobao.com/item.htm?id=1#detail'
    );

    expect(result.platform).toBe('taobao');
    expect(result.canonicalUrl).toBe('https://item.taobao.com/item.htm?id=1');
    expect(result.title).toBe('测试商品');
    expect(result.description).toBe('结构化商品描述');
    expect(result.price).toBe(99.9);
    expect(result.images.map(getRemoteImageUrl)).toEqual([
      'https://img.example.com/a.jpg?size=large',
      'https://img.example.com/b.jpg'
    ]);
    expect(result.confidence).toBe('high');
  });

  it('从京东夹具读取结构化商品信息并规范协议相对图片', () => {
    const result = parseFixture('jd-product.html', 'https://item.jd.com/1.html');

    expect(result.platform).toBe('jd');
    expect(result.title).toBe('京东结构化商品');
    expect(result.price).toBe(1299);
    expect(result.currency).toBe('CNY');
    expect(result.images.map(getRemoteImageUrl)).toEqual([
      'https://img.example.com/jd-1.jpg',
      'https://img.example.com/jd-2.jpg',
      'https://img.example.com/jd-3.jpg',
      'https://img.example.com/jd-cover.jpg'
    ]);
  });

  it('结构化数据损坏时使用通用 Open Graph 降级', () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <meta property="og:title" content="通用商品" />
        <meta property="og:description" content="通用描述" />
        <meta property="product:price:amount" content="¥66.50" />
        <meta property="product:price:currency" content="CNY" />
        <meta property="og:image" content="/cover.jpg" />
        <script type="application/ld+json">{broken</script>
      </head><body></body></html>`,
      'text/html'
    );

    const result = parseProductDocument(document, 'https://shop.example.com/product/1');

    expect(result.platform).toBe('generic');
    expect(result.title).toBe('通用商品');
    expect(result.price).toBe(66.5);
    expect(result.images.map(getRemoteImageUrl)).toEqual(['https://shop.example.com/cover.jpg']);
    expect(result.warnings).toContain('页面结构化商品数据无法解析，已使用页面信息降级');
    expect(result.confidence).toBe('medium');
  });

  it('没有有效价格时保留空值并返回警告', () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><head><title>只有标题</title></head><body></body></html>',
      'text/html'
    );

    const result = parseProductDocument(document, 'https://shop.example.com/product/2');

    expect(result.title).toBe('只有标题');
    expect(result.price).toBeNull();
    expect(result.warnings).toContain('未能识别商品价格，请手动填写');
    expect(result.confidence).toBe('low');
  });

  it('页面图片过多时只保留共享媒体上限允许的前 9 张', () => {
    const images = Array.from(
      { length: 25 },
      (_, index) => `<meta property="og:image" content="/image-${String(index + 1)}.jpg" />`
    ).join('');
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head><meta property="og:title" content="多图商品" />${images}</head></html>`,
      'text/html'
    );

    const result = parseProductDocument(document, 'https://shop.example.com/product/many-images');

    expect(result.images).toHaveLength(9);
    const finalImage = result.images.at(-1);
    expect(finalImage).toBeDefined();
    expect(finalImage === undefined ? null : getRemoteImageUrl(finalImage)).toBe(
      'https://shop.example.com/image-9.jpg'
    );
  });

  it.each([
    ['HTTP Status 400 – Bad Request', 'HTTP_400'],
    ['HTTP Status 403 – Forbidden', 'HTTP_403'],
    ['404 Not Found', 'HTTP_404'],
    ['HTTP Status 500 – Internal Server Error', 'HTTP_500'],
    ['页面不存在', 'PAGE_ERROR'],
    ['访问出错', 'PAGE_ERROR'],
    ['系统繁忙', 'PAGE_ERROR']
  ])('在候选解析前拒绝错误页标题：%s', (title, code) => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`,
      'text/html'
    );

    expect(detectProductPageError(document, 'https://item.jd.com/product/100.html')).toMatchObject({
      code
    });
    const result = extractProductDocument(
      document,
      'https://item.jd.com/product/100.html',
      '分享文案标题'
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('错误页不应产生商品');
    }
    expect(result.error.code).toBe(code);
    expect(JSON.stringify(result)).not.toContain(title);
  });

  it.each([
    ['售价 500 元，正常商品文案', '正常售价商品'],
    ['型号 404 限量版，不是错误页', '正常型号商品']
  ])('不把正文中的裸状态码数字当作 HTTP 错误：%s', (bodyText, title) => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head><meta property="og:title" content="${title}" /></head><body>${bodyText}</body></html>`,
      'text/html'
    );

    expect(detectProductPageError(document, 'https://item.jd.com/product/100.html')).toBeNull();
    const result = extractProductDocument(document, 'https://item.jd.com/product/100.html');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('正常商品页不应被拒绝');
    }
    expect(result.product.title).toBe(title);
  });

  it.each([
    ['<title>HTTP Status 500</title>', 'HTTP_500'],
    ['<title>404 Not Found</title>', 'HTTP_404'],
    ['<title>商品详情</title><body><h1>HTTP Status 403</h1></body>', 'HTTP_403']
  ])('仍拒绝具有明确状态错误语义的页面：%s', (markup, code) => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>${markup}</head></html>`,
      'text/html'
    );

    expect(detectProductPageError(document, 'https://item.jd.com/product/100.html')).toMatchObject({
      code
    });
  });

  it.each([
    ['https://item.jd.com/product/100.html', 'jd'],
    ['https://item.taobao.com/item.htm?id=1', 'taobao'],
    ['https://detail.tmall.com/item.htm?id=1', 'taobao']
  ] as const)('仅在有效 %s 商品路由缺少真实标题时使用分享标题', (pageUrl, platform) => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body></body></html>',
      'text/html'
    );
    const result = extractProductDocument(document, pageUrl, '分享文案标题');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('有效商品页应产生商品');
    }
    expect(result.product.platform).toBe(platform);
    expect(result.product.title).toBe('分享文案标题');
    expect(result.product.price).toBeNull();
    expect(result.product.images).toEqual([]);
    expect(result.product.warnings).toContain('标题来自分享文案，请核对');
  });

  it('真实页面标题优先于分享标题', () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><head><title>真实页面标题</title></head></html>',
      'text/html'
    );
    const result = extractProductDocument(
      document,
      'https://item.jd.com/product/100.html',
      '分享文案标题'
    );

    expect(result).toMatchObject({ ok: true, product: { title: '真实页面标题' } });
    expect(JSON.stringify(result)).not.toContain('标题来自分享文案，请核对');
  });

  it.each([
    '请输入验证码以继续访问',
    '请完成安全验证',
    '检测到访问风险，请完成验证',
    '扫码登录后继续'
  ])('DOM 正文指向验证或登录页面时拒绝分享标题：%s', (bodyText) => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><body>${bodyText}</body></html>`,
      'text/html'
    );
    const result = extractProductDocument(
      document,
      'https://item.jd.com/product/100.html',
      '不得使用的分享标题'
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VERIFICATION_REQUIRED' }
    });
    expect(JSON.stringify(result)).not.toContain('不得使用的分享标题');
  });

  it.each([
    'https://shop.example.com/product/100',
    'https://item.jd.com/login',
    'https://item.jd.com/verify/captcha',
    'https://item.jd.com/error/400.html'
  ])('普通页、登录页、验证页或错误路由不得使用分享标题：%s', (pageUrl) => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body></body></html>',
      'text/html'
    );
    const result = extractProductDocument(document, pageUrl, '不得使用的标题');

    expect(JSON.stringify(result)).not.toContain('不得使用的标题');
  });
});
