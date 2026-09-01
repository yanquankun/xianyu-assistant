import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getRemoteImageUrl } from '../../src/domain/product';
import {
  detectProductPageError,
  extractProductDocument,
  parseProductDocument
} from '../../src/parsers/common';
import { createEvidenceSet } from '../../src/parsers/evidence';
import { collectGenericEvidence } from '../../src/parsers/generic';
import { collectJdEvidence } from '../../src/parsers/jd';
import { mergeProductEvidence } from '../../src/parsers/merge';

function parseFixture(name: string, pageUrl: string) {
  const html = readFileSync(resolve(process.cwd(), 'tests', 'fixtures', name), 'utf8');
  const document = new DOMParser().parseFromString(html, 'text/html');
  return parseProductDocument(document, pageUrl);
}

describe('field-level product evidence', () => {
  it('分别选择高可信标题、价格、描述和图片', () => {
    const result = mergeProductEvidence(
      {
        titles: [
          {
            value: '页面标题 - 京东',
            source: 'meta',
            confidence: 'low',
            label: 'page-title'
          },
          {
            value: '当前 SKU 标题',
            source: 'embedded-state',
            confidence: 'high',
            skuId: '100'
          }
        ],
        descriptions: [
          { value: '普通 meta 描述', source: 'meta', confidence: 'medium' }
        ],
        prices: [
          {
            value: 2090,
            currency: 'CNY',
            kind: 'original',
            source: 'embedded-state',
            confidence: 'high',
            skuId: '100'
          },
          {
            value: 1881,
            currency: 'CNY',
            kind: 'conditional',
            source: 'embedded-state',
            confidence: 'high',
            skuId: '100',
            label: '到手价'
          }
        ],
        images: [
          {
            value: 'https://img.example.com/a.jpg',
            source: 'platform-gallery',
            confidence: 'high',
            position: 0
          }
        ],
        canonicalUrls: [],
        warnings: []
      },
      {
        platform: 'jd',
        pageUrl: 'https://item.jd.com/100.html',
        productId: '100',
        skuId: '100'
      }
    );

    expect(result).toMatchObject({
      title: '当前 SKU 标题',
      description: '普通 meta 描述',
      price: 1881,
      originalPrice: 2090
    });
    expect(result.warnings).toContain('当前售价为到手价，请发布前核对适用条件');
  });

  it('通用采集器读取普通描述 Meta，但忽略没有商品语义的 h1', () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><head><meta name="description" content="普通描述" /></head><body><h1>频道标题</h1></body></html>',
      'text/html'
    );
    const evidence = collectGenericEvidence(document, {
      platform: 'generic',
      pageUrl: 'https://shop.example.com/channel'
    });

    expect(evidence.descriptions).toEqual([
      { value: '普通描述', source: 'meta', confidence: 'medium' }
    ]);
    expect(evidence.titles).toEqual([]);
  });

  it('忽略绑定到其他 SKU 的价格和其他商品的推荐图片', () => {
    const evidence = createEvidenceSet();
    evidence.titles.push({
      value: '当前商品',
      source: 'embedded-state',
      confidence: 'high',
      productId: '100'
    });
    evidence.prices.push({
      value: 99,
      currency: 'CNY',
      kind: 'sale',
      source: 'embedded-state',
      confidence: 'high',
      skuId: 'other-sku'
    });
    evidence.images.push({
      value: 'https://img.example.com/recommendation.jpg',
      source: 'platform-gallery',
      confidence: 'high',
      productId: 'other-product',
      position: 0
    });

    const result = mergeProductEvidence(evidence, {
      platform: 'jd',
      pageUrl: 'https://item.jd.com/100.html',
      productId: '100',
      skuId: '100'
    });

    expect(result.title).toBe('当前商品');
    expect(result.price).toBeNull();
    expect(result.images).toEqual([]);
  });

  it('仅合并已知商品 CDN 的缩放变体，并保留未知主机的签名 URL', () => {
    const evidence = createEvidenceSet();
    evidence.images.push(
      {
        value: 'https://img10.360buyimg.com/n1/s450x450_jfs/t1/a.jpg?size=large',
        highResolutionUrl: 'https://img10.360buyimg.com/n1/s800x800_jfs/t1/a.jpg',
        source: 'platform-gallery',
        confidence: 'high',
        position: 0
      },
      {
        value: 'https://img10.360buyimg.com/n5/s54x54_jfs/t1/a.jpg?size=small',
        source: 'platform-gallery',
        confidence: 'high',
        position: 1
      },
      {
        value: 'https://cdn.example.com/a.jpg?signature=one',
        source: 'open-graph',
        confidence: 'medium',
        position: 2
      },
      {
        value: 'https://cdn.example.com/a.jpg?signature=two',
        source: 'open-graph',
        confidence: 'medium',
        position: 3
      }
    );

    const result = mergeProductEvidence(evidence, {
      platform: 'jd',
      pageUrl: 'https://item.jd.com/100.html',
      productId: '100'
    });

    expect(result.images.map(getRemoteImageUrl)).toEqual([
      'https://img10.360buyimg.com/n1/s800x800_jfs/t1/a.jpg',
      'https://cdn.example.com/a.jpg?signature=one',
      'https://cdn.example.com/a.jpg?signature=two'
    ]);
  });

  it('丢弃不高于售价的显式原价并给出警告', () => {
    const evidence = createEvidenceSet();
    evidence.prices.push(
      {
        value: 100,
        currency: 'CNY',
        kind: 'sale',
        source: 'embedded-state',
        confidence: 'high'
      },
      {
        value: 99,
        currency: 'CNY',
        kind: 'original',
        source: 'embedded-state',
        confidence: 'high'
      }
    );

    const result = mergeProductEvidence(evidence, {
      platform: 'jd',
      pageUrl: 'https://item.jd.com/100.html',
      productId: '100'
    });

    expect(result.price).toBe(100);
    expect(result.originalPrice).toBeUndefined();
    expect(result.warnings).toContain('原价不高于售价，已忽略，请发布前核对');
  });
});

describe('parseProductDocument', () => {
  it('按最终域名使用独立天猫适配器', async () => {
    const tmall = await parseFixture(
      'tmall-product.html',
      'https://detail.tmall.com/item.htm?id=200'
    );

    expect(tmall.platform).toBe('tmall');
    expect(tmall.title).toBe('天猫当前商品');
    expect(tmall.price).toBe(188);
    expect(tmall.originalPrice).toBe(209);
    expect(tmall.warnings).toContain('当前售价为会员价，请发布前核对适用条件');
    expect(tmall.images.map(getRemoteImageUrl)).toEqual([
      'https://img.alicdn.com/imgextra/tmall-a.jpg',
      'https://img.alicdn.com/imgextra/tmall-b.jpg'
    ]);
  });

  it('淘宝只读取显式商品标题标记，不使用无关 h1', async () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><h1>店铺活动标题</h1><div data-title="product-title">淘宝当前商品</div>',
      'text/html'
    );
    const result = await parseProductDocument(
      document,
      'https://item.taobao.com/item.htm?id=100'
    );

    expect(result.title).toBe('淘宝当前商品');
  });

  it('淘宝售价只取当前商品价格区并保留条件标签和显式原价', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html>
      <div data-title="product-title">淘宝当前商品</div>
      <section data-price-region="product">
        <span>到手价</span><span data-sale-price>¥88.00</span><s data-original-price>¥109.00</s>
      </section>
      <aside data-recommendation><span>推荐商品 ¥1.00</span></aside>`,
      'text/html'
    );
    const result = await parseProductDocument(
      document,
      'https://item.taobao.com/item.htm?id=100'
    );

    expect(result.price).toBe(88);
    expect(result.originalPrice).toBe(109);
    expect(result.warnings).toContain('当前售价为到手价，请发布前核对适用条件');
  });

  it('淘宝图库只采集作用域内的懒加载商品图并排除视频和推荐图', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html>
      <div data-title="product-title">淘宝当前商品</div>
      <div data-product-gallery="taobao">
        <img data-src="https://img.alicdn.com/imgextra/a.jpg" />
        <img data-lazy-src="https://img.alicdn.com/imgextra/b.jpg" />
        <div data-video><img src="https://img.alicdn.com/video-cover.jpg" /></div>
      </div>
      <div data-recommendation><img src="https://img.alicdn.com/recommendation.jpg" /></div>`,
      'text/html'
    );
    const result = await parseProductDocument(
      document,
      'https://item.taobao.com/item.htm?id=100'
    );

    expect(result.images.map(getRemoteImageUrl)).toEqual([
      'https://img.alicdn.com/imgextra/a.jpg',
      'https://img.alicdn.com/imgextra/b.jpg'
    ]);
    expect(JSON.stringify(result.images)).not.toMatch(/video-cover|recommendation/u);
  });

  it('从京东移动页内嵌状态解析当前商品、动态价格和有序图库', async () => {
    const html = readFileSync(
      resolve(process.cwd(), 'tests', 'fixtures', 'jd-mobile-product.html'),
      'utf8'
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    const names = new Map([
      ['\uE184', 'one'],
      ['\uEE94', 'eight'],
      ['\uE1AF', 'zero']
    ]);
    const context = {
      platform: 'jd' as const,
      pageUrl: 'https://item.m.jd.com/product/100.html',
      productId: '100',
      skuId: '100'
    };

    const jdEvidence = await collectJdEvidence(document, context, {
      loadPriceFont: (fontUrl) => {
        expect(fontUrl).toBe('https://spider-font-oss.360buyimg.com/test-price.otf');
        return Promise.resolve({ glyphNameFor: (character) => names.get(character) });
      }
    });
    const result = mergeProductEvidence(jdEvidence, context);

    expect(result).toMatchObject({
      title: '京东当前商品',
      description: '',
      price: 1881,
      originalPrice: 2090
    });
    expect(result.warnings).toContain('当前售价为到手价，请发布前核对适用条件');
    expect(result.images.map(getRemoteImageUrl)).toEqual([
      'https://img10.360buyimg.com/n1/jfs/a.jpg',
      'https://img10.360buyimg.com/n1/jfs/b.jpg'
    ]);
    expect(JSON.stringify(result)).not.toContain('video-cover');
  });

  it('兼容京东商品状态的尾逗号并忽略同一脚本中的动态覆盖赋值', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><script>
        window._itemOnly = ({
          "item":{"skuId":"100","skuName":"京东尾逗号商品","image":["jfs/a.jpg",],},
        });
        window._itemInfo = ({
          "stock":{"skuId":"100","realSkuId":"100",},
          "priceFloor":{
            "price":"1881.00",
            "afterDesc":{"text":"到手价",},
            "ext":{"jdPrice":"2090.00","realPriceExt":{"ORIGINAL":{"salePrice":"2090.00",},},},
          },
        });
        window._itemInfo = {item: window._itemOnly.item};
      </script>
      <ul id="loopImgUl"><li><img back_src="https://img10.360buyimg.com/n1/jfs/a.jpg" /></li></ul>`,
      'text/html'
    );
    const context = {
      platform: 'jd' as const,
      pageUrl: 'https://item.m.jd.com/product/100.html',
      productId: '100',
      skuId: '100'
    };

    const evidence = await collectJdEvidence(document, context, {
      loadPriceFont: () => Promise.reject(new Error('不应加载字体'))
    });
    const result = mergeProductEvidence(evidence, context);

    expect(result).toMatchObject({
      title: '京东尾逗号商品',
      price: 1881,
      originalPrice: 2090
    });
    expect(result.warnings).toEqual(['当前售价为到手价，请发布前核对适用条件']);
    expect(result.images.map(getRemoteImageUrl)).toEqual([
      'https://img10.360buyimg.com/n1/jfs/a.jpg'
    ]);
  });

  it('京东内嵌商品标识冲突时放弃所有平台专用字段', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><script>
        window._itemOnly = ({"item":{"skuId":"100","skuName":"错误标题","image":["jfs/a.jpg"]}});
        window._itemInfo = ({"stock":{"skuId":"200","realSkuId":"200"}});
      </script><ul id="loopImgUl"><li><img back_src="https://img10.360buyimg.com/n1/jfs/a.jpg" /></li></ul>`,
      'text/html'
    );

    const evidence = await collectJdEvidence(
      document,
      {
        platform: 'jd',
        pageUrl: 'https://item.m.jd.com/product/100.html',
        productId: '100'
      },
      { loadPriceFont: () => Promise.reject(new Error('不应加载字体')) }
    );

    expect(evidence.titles).toEqual([]);
    expect(evidence.prices).toEqual([]);
    expect(evidence.images).toEqual([]);
    expect(evidence.warnings).toEqual(['京东页面商品标识不一致，已放弃平台专用字段']);
  });

  it('京东动态字体无法解码时售价保持为空且不把原价冒充售价', async () => {
    const html = readFileSync(
      resolve(process.cwd(), 'tests', 'fixtures', 'jd-mobile-product.html'),
      'utf8'
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    const context = {
      platform: 'jd' as const,
      pageUrl: 'https://item.m.jd.com/product/100.html',
      productId: '100',
      skuId: '100'
    };

    const evidence = await collectJdEvidence(document, context, {
      loadPriceFont: () => Promise.reject(new Error('字体损坏'))
    });
    const result = mergeProductEvidence(evidence, context);

    expect(result.price).toBeNull();
    expect(result.originalPrice).toBeUndefined();
    expect(result.warnings).toContain('京东价格使用动态字体且无法可靠解码，请手动填写售价');
  });

  it('从淘宝夹具合并结构化标题、价格和图片', async () => {
    const result = await parseFixture(
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
      'https://img.example.com/a.jpg?size=small',
      'https://img.example.com/b.jpg'
    ]);
    expect(result.confidence).toBe('high');
  });

  it('从京东夹具读取结构化商品信息并规范协议相对图片', async () => {
    const result = await parseFixture('jd-product.html', 'https://item.jd.com/1.html');

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

  it('结构化数据损坏时使用通用 Open Graph 降级', async () => {
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

    const result = await parseProductDocument(document, 'https://shop.example.com/product/1');

    expect(result.platform).toBe('generic');
    expect(result.title).toBe('通用商品');
    expect(result.price).toBe(66.5);
    expect(result.images.map(getRemoteImageUrl)).toEqual(['https://shop.example.com/cover.jpg']);
    expect(result.warnings).toContain('页面结构化商品数据无法解析，已使用页面信息降级');
    expect(result.confidence).toBe('medium');
  });

  it('没有有效价格时保留空值并返回警告', async () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><head><title>只有标题</title></head><body></body></html>',
      'text/html'
    );

    const result = await parseProductDocument(document, 'https://shop.example.com/product/2');

    expect(result.title).toBe('只有标题');
    expect(result.price).toBeNull();
    expect(result.warnings).toContain('未能识别商品价格，请手动填写');
    expect(result.confidence).toBe('low');
  });

  it('页面图片过多时只保留共享媒体上限允许的前 9 张', async () => {
    const images = Array.from(
      { length: 25 },
      (_, index) => `<meta property="og:image" content="/image-${String(index + 1)}.jpg" />`
    ).join('');
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head><meta property="og:title" content="多图商品" />${images}</head></html>`,
      'text/html'
    );

    const result = await parseProductDocument(
      document,
      'https://shop.example.com/product/many-images'
    );

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
  ])('在候选解析前拒绝错误页标题：%s', async (title, code) => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`,
      'text/html'
    );

    expect(detectProductPageError(document, 'https://item.jd.com/product/100.html')).toMatchObject({
      code
    });
    const result = await extractProductDocument(
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
  ])('不把正文中的裸状态码数字当作 HTTP 错误：%s', async (bodyText, title) => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <meta property="og:title" content="${title}" />
        <meta property="product:price:amount" content="500" />
      </head><body>${bodyText}</body></html>`,
      'text/html'
    );

    expect(detectProductPageError(document, 'https://item.jd.com/product/100.html')).toBeNull();
    const result = await extractProductDocument(
      document,
      'https://item.jd.com/product/100.html'
    );
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
    'https://item.jd.com/product/100.html',
    'https://item.taobao.com/item.htm?id=1',
    'https://detail.tmall.com/item.htm?id=1'
  ])('分享标题是唯一证据时返回信息不完整：%s', async (pageUrl) => {
      const document = new DOMParser().parseFromString(
        '<!doctype html><html><body></body></html>',
        'text/html'
      );
      const result = await extractProductDocument(document, pageUrl, '分享文案标题');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'PRODUCT_INCOMPLETE',
          message: '仅识别到商品标题，售价和商品图均缺失，请重试或手动填写'
        }
      });
      expect(JSON.stringify(result)).not.toContain('分享文案标题');
    });

  it('没有标题时即使识别到售价和商品图也拒绝结果', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <meta property="product:price:amount" content="88" />
        <meta property="og:image" content="https://img.example.com/a.jpg" />
      </head></html>`,
      'text/html'
    );

    await expect(
      extractProductDocument(document, 'https://shop.example.com/product/1')
    ).resolves.toEqual({
      ok: false,
      error: { code: 'TITLE_MISSING', message: '未能可靠识别商品标题，请重试或手动填写' }
    });
  });

  it('标题加售价可以成功，但给出商品图字段警告', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <meta property="og:title" content="有售价商品" />
        <meta property="product:price:amount" content="88" />
      </head></html>`,
      'text/html'
    );
    const result = await extractProductDocument(document, 'https://shop.example.com/product/2');

    expect(result).toMatchObject({ ok: true, product: { title: '有售价商品', price: 88 } });
    if (!result.ok) {
      throw new Error('标题加售价应允许进入编辑');
    }
    expect(result.product.warnings).toContain('未能可靠识别商品图片，请手动补充');
  });

  it('标题加商品图可以成功，但给出售价字段警告', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <meta property="og:title" content="有图片商品" />
        <meta property="og:image" content="https://img.example.com/a.jpg" />
      </head></html>`,
      'text/html'
    );
    const result = await extractProductDocument(document, 'https://shop.example.com/product/3');

    expect(result).toMatchObject({ ok: true, product: { title: '有图片商品', price: null } });
    if (!result.ok) {
      throw new Error('标题加商品图应允许进入编辑');
    }
    expect(result.product.warnings).toContain('未能可靠识别售价，请手动填写');
  });

  it('条件售价通过质量门禁并保留条件警告', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html>
      <div data-title="product-title">条件价商品</div>
      <section data-price-region="product"><span>券后价</span><span data-sale-price>¥66.00</span></section>`,
      'text/html'
    );
    const result = await extractProductDocument(
      document,
      'https://item.taobao.com/item.htm?id=100'
    );

    expect(result).toMatchObject({ ok: true, product: { price: 66 } });
    if (!result.ok) {
      throw new Error('条件售价仍是有效的当前商品售价');
    }
    expect(result.product.warnings).toContain('当前售价为券后价，请发布前核对适用条件');
  });

  it('真实页面标题优先于分享标题', async () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <title>真实页面标题</title>
        <meta property="product:price:amount" content="88" />
      </head></html>`,
      'text/html'
    );
    const result = await extractProductDocument(
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
  ])('DOM 正文指向验证或登录页面时拒绝分享标题：%s', async (bodyText) => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><body>${bodyText}</body></html>`,
      'text/html'
    );
    const result = await extractProductDocument(
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
  ])('普通页、登录页、验证页或错误路由不得使用分享标题：%s', async (pageUrl) => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body></body></html>',
      'text/html'
    );
    const result = await extractProductDocument(document, pageUrl, '不得使用的标题');

    expect(JSON.stringify(result)).not.toContain('不得使用的标题');
  });
});
