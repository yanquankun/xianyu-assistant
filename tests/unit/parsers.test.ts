import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseProductDocument } from '../../src/parsers/common';

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
    expect(result.images.map((image) => image.url)).toEqual([
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
    expect(result.images.map((image) => image.url)).toEqual([
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
    expect(result.images.map((image) => image.url)).toEqual([
      'https://shop.example.com/cover.jpg'
    ]);
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
});
